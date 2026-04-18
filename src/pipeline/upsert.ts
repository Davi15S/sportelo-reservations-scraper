import { db } from '../db/client';
import { scrapeRuns, snapshots, type NewScrapeRun, type NewSnapshot } from '../db/schema/index';

const CHUNK = 500;

export async function insertSnapshots(rows: NewSnapshot[]): Promise<number> {
  if (rows.length === 0) return 0;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await db.insert(snapshots).values(chunk);
    written += chunk.length;
  }
  return written;
}

export async function insertScrapeRun(run: NewScrapeRun): Promise<void> {
  await db.insert(scrapeRuns).values(run);
}
