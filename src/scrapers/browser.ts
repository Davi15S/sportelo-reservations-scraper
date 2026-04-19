import { chromium, type Browser } from 'playwright';
import { logger } from '../utils/logger';

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser) return browser;
  logger.debug('launching chromium');
  // Default bundled chromium (bez channel — 'chromium' channel by vyžadovalo separate install).
  // --disable-blink-features=AutomationControlled skrývá navigator.webdriver flag před
  // Cloudflare/bot-protection vrstvami. --no-sandbox + --disable-dev-shm-usage jsou
  // standard pro container runtime (DO App Platform).
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
