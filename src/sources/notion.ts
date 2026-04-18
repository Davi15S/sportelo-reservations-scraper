import { Client, isFullPage } from '@notionhq/client';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const notion = new Client({ auth: env.NOTION_TOKEN });

const PROP_NAME = 'Name';
const PROP_URL = 'Reservation URL';
const PROP_ACTIVE = 'Scraper Active';
const PROP_SPORT = 'Sport';

export type NotionFacilityRaw = {
  notionPageId: string;
  name: string;
  reservationUrl: string;
  sport: string;
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
      const sportProp = props[PROP_SPORT];

      if (nameProp?.type !== 'title' || urlProp?.type !== 'url' || activeProp?.type !== 'checkbox' || sportProp?.type !== 'select') {
        logger.warn({ pageId: page.id }, 'skipping row with unexpected property types');
        continue;
      }

      const name = nameProp.title.map((t) => t.plain_text).join('').trim();
      const url = urlProp.url;
      const active = activeProp.checkbox;
      const sport = sportProp.select?.name ?? null;

      if (!name || !url || !sport) {
        logger.warn({ pageId: page.id, name, url, sport }, 'skipping row with missing name/URL/sport');
        continue;
      }

      out.push({ notionPageId: page.id, name, reservationUrl: url, sport, active });
    }

    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);

  return out;
}
