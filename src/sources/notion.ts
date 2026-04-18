import { Client, isFullPage } from '@notionhq/client';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import type { Facility } from '../scrapers/types';

const notion = new Client({ auth: env.NOTION_TOKEN });

const PROP_NAME = 'Name';
const PROP_URL = 'Reservation URL';
const PROP_ACTIVE = 'Scraper Active';

export async function listFacilities(): Promise<Facility[]> {
  const facilities: Facility[] = [];
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

      if (nameProp?.type !== 'title' || urlProp?.type !== 'url' || activeProp?.type !== 'checkbox') {
        logger.warn({ pageId: page.id }, 'skipping row with unexpected property types');
        continue;
      }

      const name = nameProp.title.map((t) => t.plain_text).join('').trim();
      const url = urlProp.url;
      const active = activeProp.checkbox;

      if (!name || !url) {
        logger.warn({ pageId: page.id, name, url }, 'skipping row with missing name or URL');
        continue;
      }

      facilities.push({ id: page.id, name, reservationUrl: url, active });
    }

    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);

  return facilities;
}
