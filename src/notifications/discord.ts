import { env } from '../config/env';
import { logger } from '../utils/logger';

export type DiscordEmbed = {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
};

export type DiscordPayload = {
  content?: string;
  username?: string;
  embeds?: DiscordEmbed[];
};

export const COLOR = {
  green: 0x57f287,
  yellow: 0xfee75c,
  red: 0xed4245,
  blurple: 0x5865f2,
};

/**
 * Pošle zprávu na Discord webhook. Pokud `DISCORD_WEBHOOK_URL` není
 * nastaven, no-op (log debug). Selhání odeslání zaloguje jako error,
 * ale nevyhodí — notifikace nesmí přerušit scrape pipeline.
 */
export async function sendDiscord(payload: DiscordPayload): Promise<void> {
  const url = env.DISCORD_WEBHOOK_URL;
  if (!url) {
    logger.debug('DISCORD_WEBHOOK_URL not set — skipping notification');
    return;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Sportelo Scraper', ...payload }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error({ status: res.status, body: body.slice(0, 500) }, 'discord webhook failed');
      return;
    }
    logger.info({ status: res.status }, 'discord notification sent');
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'discord webhook error');
  }
}
