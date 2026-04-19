import type { Browser } from 'playwright';
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { logger } from '../utils/logger';

// playwright-extra drop-in wrapper. Stealth plugin maskuje 20+ bot fingerprintů
// (navigator.webdriver, chrome runtime, WebGL vendor, plugins length, atd.).
// Cílové použití: projít Cloudflare Turnstile basic check, který na GH Actions
// runnerech jinak blokuje jdemenato.cz.
chromium.use(stealth());

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser) return browser;
  logger.debug('launching chromium (stealth)');
  browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (!browser) return;
  await browser.close();
  browser = null;
}
