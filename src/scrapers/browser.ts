import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright';
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { env } from '../config/env';
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

/**
 * Sdílené defaultní options pro `browser.newContext()`. Injectuje proxy
 * z env (pokud PROXY_URL nastaven — používá se na GH Actions / DO, aby CF
 * Turnstile viděl residential/mobile IP místo datacenter runneru).
 */
export function getContextOptions(): BrowserContextOptions {
  const base: BrowserContextOptions = {
    locale: 'cs-CZ',
    timezoneId: 'Europe/Prague',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };
  const proxy = parseProxyUrl(env.PROXY_URL);
  if (proxy) base.proxy = proxy;
  return base;
}

/**
 * Chyby transient pro proxy tunel. Webshare CZ-rotate = rotující pool; občas
 * dostaneš mrtvý endpoint a CONNECT selže. Retry se zavřením kontextu dá
 * čerstvý upstream.
 */
const TRANSIENT_NAV_ERROR_RE =
  /ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE|ERR_SOCKS_CONNECTION_FAILED|ERR_TIMED_OUT|net::ERR_NETWORK_CHANGED/i;

/**
 * Otevře nový kontext + page a naviguje na URL. Na transientní tunnel/network
 * chyby (typicky Webshare rotating IP) retryuje až `maxAttempts` krát s novým
 * kontextem (= nová proxy session). Caller dostane živý context+page a je
 * odpovědný za zavření kontextu.
 */
export async function openContextAndGoto(
  browser: Browser,
  url: string,
  opts: { timeout: number; maxAttempts?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' },
): Promise<{ context: BrowserContext; page: Page }> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const waitUntil = opts.waitUntil ?? 'domcontentloaded';
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const context = await browser.newContext(getContextOptions());
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil, timeout: opts.timeout });
      return { context, page };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient = TRANSIENT_NAV_ERROR_RE.test(msg);
      await context.close().catch(() => undefined);
      if (!transient || attempt === maxAttempts) throw err;
      const backoffMs = 500 * attempt;
      logger.warn(
        { url, attempt, maxAttempts, err: msg, backoffMs },
        'transient navigation error, retrying with fresh context',
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Rozparsuje `http://user:pass@host:port` na Playwright proxy config.
 * User/password jsou optional — residential proxy se tlačí přes URL auth,
 * ale některé poskytovatelé umožňují i IP whitelist bez creds.
 */
function parseProxyUrl(url: string | undefined): BrowserContextOptions['proxy'] | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return {
      server: `${parsed.protocol}//${parsed.host}`,
      username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    };
  } catch {
    logger.warn({ url: '<redacted>' }, 'PROXY_URL invalid, ignoring');
    return null;
  }
}
