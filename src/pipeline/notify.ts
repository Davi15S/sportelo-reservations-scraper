import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { COLOR, sendDiscord, type DiscordEmbed } from '../notifications/discord';
import { todayInPrague } from '../utils/date';
import type { FacilityScrapeResult } from '../scrapers/types';
import type { PendingError } from './errors';

const EMPTY = '(žádná data)';

/**
 * Ranní notifikace — seznam co jsme posbírali per facility × sport dnešního dne.
 * Zdroj: benchmarks.snapshots (ne daily_summaries, která se teprve tvoří odpoledne).
 */
export async function sendMorningReport(args: {
  results: FacilityScrapeResult[];
  errors: PendingError[];
}): Promise<void> {
  const today = todayInPrague();
  const rows = await db.execute<{
    facility_name: string;
    sport: string;
    total: number;
    available: number;
  }>(sql`
    SELECT
      facility_name,
      sport,
      COUNT(*)::int AS total,
      SUM((is_available)::int)::int AS available
    FROM benchmarks.snapshots
    WHERE date_checked = ${today}
    GROUP BY facility_name, sport
    ORDER BY facility_name, sport
  `);

  const fields: NonNullable<DiscordEmbed['fields']> = groupByFacility(rows.rows ?? []);
  const embed: DiscordEmbed = {
    title: `Ranní scrape — ${today}`,
    description: fields.length === 0 ? EMPTY : `Posbíráno per sportoviště / sport (${today}).`,
    color: pickColor(args.errors.length > 0, args.results),
    fields: fields.length > 0 ? fields : undefined,
    timestamp: new Date().toISOString(),
    footer: { text: `facilities: ${args.results.length} ok/${countFailed(args.results)} failed` },
  };

  await sendDiscord({ embeds: [embed] });
  if (args.errors.length > 0) await sendErrorReport({ errors: args.errors, title: 'Ranní scrape — chyby' });
}

/**
 * Odpolední notifikace — celodenní summary z daily_summaries po summary buildu.
 */
export async function sendAfternoonReport(args: {
  results: FacilityScrapeResult[];
  errors: PendingError[];
}): Promise<void> {
  const today = todayInPrague();
  const rows = await db.execute<{
    facility_name: string;
    sport: string;
    total_slots: number;
    available_slots: number;
    booked_slots: number;
    occupancy_pct: string;
    courts_count: number;
  }>(sql`
    SELECT facility_name, sport, total_slots, available_slots, booked_slots, occupancy_pct, courts_count
    FROM benchmarks.daily_summaries
    WHERE summary_date = ${today}
    ORDER BY facility_name, sport
  `);

  const fields: DiscordEmbed['fields'] = [];
  const byFacility = new Map<string, string[]>();
  for (const r of rows.rows ?? []) {
    const line = `\`${r.sport}\` — **${r.occupancy_pct}%** (${r.booked_slots}/${r.total_slots} obsazeno · ${r.courts_count} kurty)`;
    const list = byFacility.get(r.facility_name) ?? [];
    list.push(line);
    byFacility.set(r.facility_name, list);
  }
  for (const [facility, lines] of byFacility) {
    fields.push({ name: facility, value: lines.join('\n') });
  }

  const embed: DiscordEmbed = {
    title: `Celodenní shrnutí — ${today}`,
    description: fields.length === 0 ? EMPTY : 'Obsazenost per sportoviště / sport za celý den.',
    color: pickColor(args.errors.length > 0, args.results),
    fields: fields.length > 0 ? fields : undefined,
    timestamp: new Date().toISOString(),
    footer: { text: `facilities: ${args.results.length} ok/${countFailed(args.results)} failed` },
  };

  await sendDiscord({ embeds: [embed] });
  if (args.errors.length > 0) await sendErrorReport({ errors: args.errors, title: 'Odpolední scrape — chyby' });
}

/** Discord notifikace jen pro chyby (použije se samostatně nebo jako dodatek). */
export async function sendErrorReport(args: {
  errors: PendingError[];
  title: string;
}): Promise<void> {
  if (args.errors.length === 0) return;

  const fields = args.errors.slice(0, 10).map((e, i) => ({
    name: `${i + 1}. ${e.stage} · ${e.errorType}${e.facilityName ? ` · ${e.facilityName}` : ''}`,
    value: truncate(e.errorMessage, 900),
  }));

  const embed: DiscordEmbed = {
    title: args.title,
    description: `Zachyceno **${args.errors.length}** chyb.`,
    color: COLOR.red,
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: args.errors.length > 10 ? `+${args.errors.length - 10} dalších v DB` : 'detail: benchmarks.scrape_errors' },
  };

  await sendDiscord({ embeds: [embed] });
}

function groupByFacility(rows: Array<{ facility_name: string; sport: string; total: number; available: number }>): NonNullable<DiscordEmbed['fields']> {
  const byFacility = new Map<string, string[]>();
  for (const r of rows) {
    const line = `\`${r.sport}\`: ${r.total} slotů (${r.available} volných)`;
    const list = byFacility.get(r.facility_name) ?? [];
    list.push(line);
    byFacility.set(r.facility_name, list);
  }
  return [...byFacility.entries()].map(([facility, lines]) => ({
    name: facility,
    value: lines.join('\n'),
  }));
}

function countFailed(results: FacilityScrapeResult[]): number {
  return results.filter((r) => r.status === 'failed').length;
}

function pickColor(hasErrors: boolean, results: FacilityScrapeResult[]): number {
  if (hasErrors) return COLOR.red;
  if (countFailed(results) > 0) return COLOR.yellow;
  return COLOR.green;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
