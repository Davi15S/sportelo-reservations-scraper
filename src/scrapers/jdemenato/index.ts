import type { Frame, Page } from 'playwright';
import { getBrowser, openContextAndGoto } from '../browser';
import { logger } from '../../utils/logger';
import { nowMinutesInPrague, todayInPrague } from '../../utils/date';
import type { Facility, FacilityScrapeResult, SlotSnapshot } from '../types';
import { buildSnapshots, type TableSnapshot } from './parser';

const NAV_TIMEOUT_MS = 60_000;
const IFRAME_WAIT_MS = 45_000;
const TABLE_WAIT_MS = 40_000;
const SETTLE_MS = 1_500;
const PER_SPORT_SETTLE_MS = 2_000;
const IFRAME_SELECTOR = 'iframe[src*="jdemenato.cz"]';
const TABLE_SELECTOR = 'table.verticalTimetable';
const SPORT_LINK_SELECTOR = 'a[href*="selectsport"]';

type SportTab = { id: string; name: string; isSelected: boolean };

/**
 * jdemenato.cz běží hosted, ale sportoviště ho typicky embedují přes iframe
 * (`<iframe src="https://jdemenato.cz/reservation/<slug>/...">`). Scraper najde
 * iframe, čeká na `table.verticalTimetable` a pro každý sport tab (`a[href*="selectsport"]`)
 * parsuje DOM. Kliknutí na tab naviguje iframe same-origin — Playwright `Frame`
 * reference zůstává platná.
 */
export async function scrapeJdemenatoFacility(facility: Facility): Promise<FacilityScrapeResult> {
  const browser = await getBrowser();
  const { context, page } = await openContextAndGoto(browser, facility.reservationUrl, {
    timeout: NAV_TIMEOUT_MS,
  });

  try {
    const frame = await resolveJdemenatoFrame(page);
    if (!frame) throw new Error('jdemenato iframe not found on page');

    await frame.waitForLoadState('domcontentloaded', { timeout: IFRAME_WAIT_MS });
    await frame.waitForLoadState('networkidle', { timeout: IFRAME_WAIT_MS }).catch(() => undefined);
    await frame.waitForSelector(TABLE_SELECTOR, { timeout: TABLE_WAIT_MS });
    await page.waitForTimeout(SETTLE_MS);

    const sports = await readSports(frame);
    logger.info({ facility: facility.name, sports: sports.map((s) => s.name) }, 'jdemenato sports detected');

    const today = todayInPrague();
    const nowMinutes = nowMinutesInPrague();
    const allSnapshots: SlotSnapshot[] = [];

    if (sports.length === 0) {
      const table = await extractTable(frame);
      if (table) allSnapshots.push(...buildSnapshots({ table, dateChecked: today, sportName: null, nowMinutes }));
    } else {
      for (const sport of sports) {
        if (!sport.isSelected) {
          const ok = await selectSport(frame, sport.id);
          if (!ok) {
            logger.warn({ facility: facility.name, sport: sport.name }, 'could not select sport');
            continue;
          }
          await frame.waitForSelector(TABLE_SELECTOR, { timeout: TABLE_WAIT_MS });
          await page.waitForTimeout(PER_SPORT_SETTLE_MS);
        }
        const table = await extractTable(frame);
        if (!table) {
          logger.warn({ facility: facility.name, sport: sport.name }, 'no table for sport');
          continue;
        }
        const snaps = buildSnapshots({ table, dateChecked: today, sportName: sport.name, nowMinutes });
        allSnapshots.push(...snaps);
        logger.info(
          { facility: facility.name, sport: sport.name, courts: table.courts.length, slots: snaps.length },
          'jdemenato sport scraped',
        );
      }
    }

    const snapshots = allSnapshots.filter((s) => s.dateChecked === today);
    logger.info(
      {
        facility: facility.name,
        today,
        sportCount: Math.max(sports.length, 1),
        slotCountTotal: allSnapshots.length,
        slotCountToday: snapshots.length,
      },
      'jdemenato timetable parsed',
    );

    return {
      status: 'ok',
      facility,
      snapshots,
      rawSample: { services: sports.map((s) => s.name), dayCount: 1, today },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message, facility: facility.name }, 'jdemenato scrape failed');
    const debugScreenshot = await captureScreenshotBase64(page);
    return { status: 'failed', facility, error: message, debugScreenshot };
  } finally {
    await context.close();
  }
}

/**
 * Zachytí screenshot jako base64 pro post-mortem debug (CF challenge vs. 403).
 * Oříznuté na 200 KB base64 (~150 KB PNG), aby řádek v scrape_errors.context
 * JSONB nenabobtnal. Tichá failovka — screenshot error nesmí maskovat původní.
 */
async function captureScreenshotBase64(page: Page): Promise<string | null> {
  try {
    const buf = await page.screenshot({ fullPage: true, timeout: 10_000 });
    const b64 = buf.toString('base64');
    return b64.length > 200_000 ? b64.slice(0, 200_000) : b64;
  } catch {
    return null;
  }
}

/**
 * Najde iframe ukazující na jdemenato.cz a naviguje stránku přímo na jeho src.
 * Tím obchází wrapper (tempotenis.cz, atd.) a případné CF vrstvy na parent stránce
 * — worker pak mluví přímo s jdemenato. Když URL sama už JE jdemenato (user
 * dal přímý link), vrací main frame bez navigace.
 *
 * Fallback: pokud iframe src nelze extrahovat, vrací klasický contentFrame().
 */
async function resolveJdemenatoFrame(page: Page): Promise<Frame | null> {
  if (page.url().includes('jdemenato.cz')) return page.mainFrame();
  try {
    await page.waitForSelector(IFRAME_SELECTOR, { timeout: IFRAME_WAIT_MS });
    const iframeSrc = await page
      .locator(IFRAME_SELECTOR)
      .first()
      .getAttribute('src')
      .catch(() => null);
    if (iframeSrc && iframeSrc.includes('jdemenato.cz')) {
      await page.goto(iframeSrc, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      return page.mainFrame();
    }
    const handle = await page.waitForSelector(IFRAME_SELECTOR, { timeout: IFRAME_WAIT_MS });
    return await handle.contentFrame();
  } catch {
    return null;
  }
}

async function readSports(frame: Frame): Promise<SportTab[]> {
  try {
    return await frame.evaluate((selector) => {
      const nodes = Array.from(document.querySelectorAll<HTMLAnchorElement>(selector));
      const seen = new Set<string>();
      const out: { id: string; name: string; isSelected: boolean }[] = [];
      for (const a of nodes) {
        const href = a.getAttribute('href') ?? '';
        const match = href.match(/selectsport\/(\d+)/);
        if (!match) continue;
        const id = match[1]!;
        if (seen.has(id)) continue;
        seen.add(id);
        const name = (a.textContent ?? '').trim();
        if (!name) continue;
        out.push({ id, name, isSelected: /\bselected-sport\b/.test(a.className) });
      }
      return out;
    }, SPORT_LINK_SELECTOR);
  } catch {
    return [];
  }
}

async function selectSport(frame: Frame, sportId: string): Promise<boolean> {
  try {
    const link = frame.locator(`a[href*="selectsport/${sportId}"]`).first();
    if (!(await link.count())) return false;
    const prevUrl = frame.url();
    await link.click();
    // iframe se re-loaduje na novou URL (nová jsessionid + sport). Bez čekání
    // na change by waitForSelector prošel na staré tabulce a extrakt by vrátil
    // předchozí sport.
    await frame
      .waitForFunction((prev) => location.href !== prev, prevUrl, { timeout: TABLE_WAIT_MS })
      .catch(() => undefined);
    await frame.waitForLoadState('domcontentloaded', { timeout: TABLE_WAIT_MS });
    await frame.waitForLoadState('networkidle', { timeout: TABLE_WAIT_MS }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

async function extractTable(frame: Frame): Promise<TableSnapshot | null> {
  try {
    // POZOR: tsx/esbuild transformer přidává `__name` helper kolem pojmenovaných
    // funkcí — browser kontext evaluate pak padá `ReferenceError: __name`.
    // Řešení: držet tělo jako jednu anonymní arrow bez vnořených pojmenovaných
    // funkcí. Všechnu logiku inline.
    return await frame.evaluate((selector) => {
      const table = document.querySelector(selector);
      if (!table) return null;
      const courts = Array.from(table.querySelectorAll('thead th.serviceTop')).map((th) =>
        (th.textContent ?? '').trim(),
      );
      const rows: { status: 'free' | 'occupied' | 'closed' | 'lesson' | null; timeMinutes: number | null; rowspan: number; isPast: boolean }[][] = [];
      for (const tr of Array.from(table.querySelectorAll('tbody tr'))) {
        const row: typeof rows[number] = [];
        for (const td of Array.from(tr.querySelectorAll('td'))) {
          const cls = td.className;
          let status: 'free' | 'occupied' | 'closed' | 'lesson' | null = null;
          if (/\btimetableFree\b/.test(cls)) status = 'free';
          else if (/\btimetableOccupied\b/.test(cls)) status = 'occupied';
          else if (/\btimetableClosed\b/.test(cls)) status = 'closed';
          else if (/\btimetableLesson\b/.test(cls)) status = 'lesson';
          const timeMatch = cls.match(/\btime(\d+)\b/);
          const timeMinutes = timeMatch ? parseInt(timeMatch[1]!, 10) : null;
          const rowspanAttr = td.getAttribute('rowspan');
          const rowspan = rowspanAttr ? Math.max(parseInt(rowspanAttr, 10) || 1, 1) : 1;
          row.push({
            status,
            timeMinutes: timeMinutes !== null && Number.isFinite(timeMinutes) ? timeMinutes : null,
            rowspan,
            isPast: /\btimetableTimeRelationPast\b/.test(cls),
          });
        }
        rows.push(row);
      }
      return { courts, rows };
    }, TABLE_SELECTOR);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'extractTable failed');
    return null;
  }
}
