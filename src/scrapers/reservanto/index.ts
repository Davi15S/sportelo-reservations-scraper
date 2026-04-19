import type { Frame } from 'playwright';
import { getBrowser } from '../browser';
import { logger } from '../../utils/logger';
import { todayInPrague } from '../../utils/date';
import type { Facility, FacilityScrapeResult, SlotSnapshot } from '../types';
import { daysToSnapshots, extractDaysJson, slugify } from './parser';

const NAV_TIMEOUT_MS = 30_000;
const CALENDAR_WAIT_MS = 20_000;
const SETTLE_MS = 2_000;
const PER_SERVICE_SETTLE_MS = 2_500;
const IFRAME_SELECTOR = 'iframe[src*="booking.reservanto.cz/form"]';
const CALENDAR_SELECTOR = '#hcalendar-daily .day, #calendar-left .day, .calendar-horizontal .day';

type Service = { id: string; name: string };

/**
 * Reservanto widget má `<select id="booking-service">` s výčtem služeb (např.
 * Padel Neride: "Padle tenis - hala zima", "Padel tenis - hala léto",
 * "Tenis hala"). Calendar-bootstrap v inline scriptu vidí jen aktuálně
 * vybranou službu — pro získání kompletních dat iterujeme přes dropdown.
 */
export async function scrapeReservantoFacility(facility: Facility): Promise<FacilityScrapeResult> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    locale: 'cs-CZ',
    timezoneId: 'Europe/Prague',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    await page.goto(facility.reservationUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

    const iframeEl = await page.waitForSelector(IFRAME_SELECTOR, { timeout: CALENDAR_WAIT_MS });
    const frame = await iframeEl.contentFrame();
    if (!frame) throw new Error('reservanto iframe has no accessible content');

    await frame.waitForLoadState('domcontentloaded', { timeout: CALENDAR_WAIT_MS });
    await frame.waitForLoadState('networkidle', { timeout: CALENDAR_WAIT_MS }).catch(() => undefined);
    await frame.waitForSelector(CALENDAR_SELECTOR, { timeout: CALENDAR_WAIT_MS }).catch(() => undefined);
    await page.waitForTimeout(SETTLE_MS);

    const services = await readServices(frame);
    logger.info({ facility: facility.name, services }, 'reservanto services detected');

    const today = todayInPrague();
    const allSnapshots: SlotSnapshot[] = [];
    let totalDays = 0;

    if (services.length === 0) {
      // Monoservice widget — bootstrap už má data, jen je přečti.
      const snaps = await extractCurrentService(frame, null);
      allSnapshots.push(...snaps.snapshots);
      totalDays += snaps.dayCount;
    } else {
      for (const svc of services) {
        const selected = await selectService(frame, svc.id);
        if (!selected) {
          logger.warn({ facility: facility.name, serviceId: svc.id }, 'could not select service');
          continue;
        }
        await page.waitForTimeout(PER_SERVICE_SETTLE_MS);
        const snaps = await extractCurrentService(frame, svc.name);
        allSnapshots.push(...snaps.snapshots);
        totalDays += snaps.dayCount;
        logger.info(
          { facility: facility.name, service: svc.name, slots: snaps.snapshots.length },
          'reservanto service scraped',
        );
      }
    }

    const snapshots = allSnapshots.filter((s) => s.dateChecked === today);

    /**
     * Pro služby, které dnes nemají žádné sloty (mimo sezónu — např. letní
     * hala v dubnu), vezmeme slot template z nejbližšího dne kde data jsou,
     * přemapujeme datum na dnes a označíme `is_available=false`. Výsledek:
     * služba se ve statistikách objeví jako "100% obsazeno" místo aby
     * zmizela.
     */
    const servicesWithToday = new Set(snapshots.map((s) => s.sport));
    for (const svc of services) {
      const slug = slugify(svc.name);
      if (servicesWithToday.has(slug)) continue;
      const template = pickTemplate(allSnapshots, slug);
      if (template.length === 0) continue;
      for (const t of template) {
        snapshots.push({ ...t, dateChecked: today, isAvailable: false });
      }
      logger.info(
        { facility: facility.name, service: svc.name, syntheticSlots: template.length },
        'reservanto off-season service synthesized as 100% booked',
      );
    }

    logger.info(
      {
        facility: facility.name,
        today,
        serviceCount: Math.max(services.length, 1),
        slotCountTotal: allSnapshots.length,
        slotCountToday: snapshots.length,
      },
      'reservanto calendar parsed',
    );

    return {
      status: 'ok',
      facility,
      snapshots,
      rawSample: { services: services.map((s) => s.name), dayCount: totalDays, today },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message, facility: facility.name }, 'reservanto scrape failed');
    return { status: 'failed', facility, error: message };
  } finally {
    await context.close();
  }
}

async function readServices(frame: Frame): Promise<Service[]> {
  try {
    return await frame.evaluate(() => {
      const select = document.querySelector<HTMLSelectElement>('#booking-service select, select#booking-service');
      if (!select) return [];
      return Array.from(select.options)
        .map((o) => ({ id: o.value, name: (o.textContent ?? '').trim() }))
        .filter((o) => o.id && o.name);
    });
  } catch {
    return [];
  }
}

async function selectService(frame: Frame, serviceId: string): Promise<boolean> {
  try {
    return await frame.evaluate((id) => {
      const select = document.querySelector<HTMLSelectElement>('#booking-service select, select#booking-service');
      if (!select) return false;
      select.value = id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return select.value === id;
    }, serviceId);
  } catch {
    return false;
  }
}

/** Vybere sloty nejbližšího dne, pro který služba nějaká data má. */
function pickTemplate(all: SlotSnapshot[], slug: string): SlotSnapshot[] {
  const forService = all.filter((s) => s.sport === slug);
  if (forService.length === 0) return [];
  const dates = [...new Set(forService.map((s) => s.dateChecked))].sort();
  const firstDate = dates[0];
  if (!firstDate) return [];
  return forService.filter((s) => s.dateChecked === firstDate);
}

async function extractCurrentService(
  frame: Frame,
  serviceName: string | null,
): Promise<{ snapshots: SlotSnapshot[]; dayCount: number }> {
  await frame.waitForLoadState('networkidle', { timeout: CALENDAR_WAIT_MS }).catch(() => undefined);
  const inlineScripts: string[] = await frame.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('script:not([src])'));
    return nodes.map((n) => n.textContent ?? '');
  });
  const days = extractDaysJson(inlineScripts);
  if (!days) return { snapshots: [], dayCount: 0 };
  return { snapshots: daysToSnapshots(days, serviceName), dayCount: days.length };
}
