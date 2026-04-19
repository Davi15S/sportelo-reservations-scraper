import { Client, isFullPage } from '@notionhq/client';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import type { ReservationSystem } from '../scrapers/types';

const notion = new Client({ auth: env.NOTION_TOKEN });

const PROP_NAME = 'Name';
const PROP_URL = 'Reservation URL';
const PROP_ACTIVE = 'Scraper Active';
const PROP_SYSTEM = 'Reservation System';

const VALID_SYSTEMS: ReservationSystem[] = ['reservanto', 'jdemenato', 'bizzi', 'sroger'];

export type NotionFacilityRaw = {
  notionPageId: string;
  name: string;
  reservationUrl: string;
  reservationSystem: ReservationSystem;
  active: boolean;
};

export async function listNotionFacilities(): Promise<NotionFacilityRaw[]> {
  const out: NotionFacilityRaw[] = [];
  let cursor: string | undefined;

  do {
    const res = await notion.databases.query({
      database_id: env.NOTION_DATABASE_ID,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of res.results) {
      if (!isFullPage(page)) continue;

      const props = page.properties;
      const nameProp = props[PROP_NAME];
      const urlProp = props[PROP_URL];
      const activeProp = props[PROP_ACTIVE];
      const systemProp = props[PROP_SYSTEM];

      if (
        nameProp?.type !== 'title' ||
        urlProp?.type !== 'url' ||
        activeProp?.type !== 'checkbox' ||
        systemProp?.type !== 'select'
      ) {
        logger.warn({ pageId: page.id }, 'skipping row with unexpected property types');
        continue;
      }

      const name = nameProp.title.map((t) => t.plain_text).join('').trim();
      const url = urlProp.url;
      const active = activeProp.checkbox;
      const rawSystem = systemProp.select?.name ?? null;

      if (!name || !url || !rawSystem) {
        logger.warn({ pageId: page.id, name, url, rawSystem }, 'skipping row with missing name/URL/system');
        continue;
      }

      if (!VALID_SYSTEMS.includes(rawSystem as ReservationSystem)) {
        logger.warn({ pageId: page.id, rawSystem }, 'skipping row with unknown reservation system');
        continue;
      }

      out.push({
        notionPageId: page.id,
        name,
        reservationUrl: url,
        reservationSystem: rawSystem as ReservationSystem,
        active,
      });
    }

    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);

  return out;
}
