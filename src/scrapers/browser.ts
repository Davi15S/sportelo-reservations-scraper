import { chromium, type Browser } from 'playwright';
import { logger } from '../utils/logger';

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser) return browser;
  logger.debug('launching chromium');
  // channel: 'chromium' → full chromium místo chrome-headless-shell (default v PW 1.55+).
  // Headless-shell agresivněji detekují bot-ochranné vrstvy (Cloudflare, atd.), full
  // chromium projde lépe. --disable-blink-features=AutomationControlled skrývá flag
  // `navigator.webdriver`.
  browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
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
