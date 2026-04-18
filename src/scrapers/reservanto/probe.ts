/**
 * Uloží kompletní DOM Reservanto iframu po renderu kalendáře.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const targetUrl = process.argv[2] ?? 'https://padelneride.cz/rezervace/';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'cs-CZ',
    timezoneId: 'Europe/Prague',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  console.log(`opening ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  const iframeEl = await page.waitForSelector('iframe[src*="booking.reservanto.cz/form"]', { timeout: 20_000 });
  const frame = await iframeEl.contentFrame();
  if (!frame) throw new Error('cannot access reservanto iframe content');

  console.log('iframe URL:', frame.url());

  await frame.waitForLoadState('domcontentloaded', { timeout: 20_000 });
  await frame.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  await frame
    .waitForSelector('#hcalendar-daily .day, #calendar-left .day, .calendar-horizontal .day', { timeout: 20_000 })
    .catch(() => console.log('no .day selector appeared'));
  await page.waitForTimeout(5_000);

  const html = await frame.content();
  console.log(`iframe html size: ${html.length} chars`);

  await mkdir('reports', { recursive: true });
  const host = new URL(targetUrl).hostname.replace(/[^a-z0-9]+/gi, '_');
  const file = join('reports', `iframe-${host}.html`);
  await writeFile(file, html, 'utf8');
  console.log(`saved \u2192 ${file}`);

  const inlineScripts: string[] = await frame.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script:not([src])'));
    return scripts.map((s) => (s.textContent ?? '').slice(0, 60000));
  });
  const bootstrap = inlineScripts.find((s) => /calendarDays|locations|reservations|availability/i.test(s));
  if (bootstrap) {
    const bfile = join('reports', `bootstrap-${host}.js`);
    await writeFile(bfile, bootstrap, 'utf8');
    console.log(`bootstrap script saved \u2192 ${bfile} (${bootstrap.length} chars)`);
  } else {
    console.log('no bootstrap with calendar data found');
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
