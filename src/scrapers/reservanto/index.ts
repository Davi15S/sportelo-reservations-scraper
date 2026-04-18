import { getBrowser } from '../browser';
import { logger } from '../../utils/logger';
import { todayInPrague } from '../../utils/date';
import type { Facility, FacilityScrapeResult, SlotSnapshot } from '../types';
import { daysToSnapshots, extractDaysJson } from './parser';

const NAV_TIMEOUT_MS = 30_000;
const CALENDAR_WAIT_MS = 20_000;
const SETTLE_MS = 3_000;
const IFRAME_SELECTOR = 'iframe[src*="booking.reservanto.cz/form"]';
const CALENDAR_SELECTOR = '#hcalendar-daily .day, #calendar-left .day, .calendar-horizontal .day';

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

    const inlineScripts: string[] = await frame.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('script:not([src])'));
      return nodes.map((n) => n.textContent ?? '');
    });

    const days = extractDaysJson(inlineScripts);
    if (!days) {
      logger.warn(
        { facility: facility.name, scriptCount: inlineScripts.length },
        'reservanto: could not locate days[] JSON in inline scripts',
      );
      return { status: 'ok', facility, snapshots: [], rawSample: null };
    }

    const today = todayInPrague();
    const allSnapshots: SlotSnapshot[] = daysToSnapshots(days);
    const snapshots = allSnapshots.filter((s) => s.dateChecked === today);
    logger.info(
      {
        facility: facility.name,
        today,
        dayCount: days.length,
        slotCountTotal: allSnapshots.length,
        slotCountToday: snapshots.length,
      },
      'reservanto parsed calendar (today-only filter applied)',
    );
    return {
      status: 'ok',
      facility,
      snapshots,
      rawSample: { dayCount: days.length, firstDayFormatted: days[0]?.dayFormatted ?? null, today },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message, facility: facility.name }, 'reservanto scrape failed');
    return { status: 'failed', facility, error: message };
  } finally {
    await context.close();
  }
}
