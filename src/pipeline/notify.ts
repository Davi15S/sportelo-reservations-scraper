import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { COLOR, sendDiscord, type DiscordEmbed } from '../notifications/discord';
import { slugify } from '../scrapers/reservanto/parser';
import { todayInPrague } from '../utils/date';
import type { FacilityScrapeResult } from '../scrapers/types';
import type { PendingError } from './errors';

const EMPTY = '(žádná data)';

type FacilityRow<Payload> = {
  facilityName: string;
  bySport: Map<string, Payload>;
  services: string[];
};

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
    FROM (
      SELECT DISTINCT ON (facility_id, date_checked, time_slot, court_id, sport)
        facility_id, facility_name, sport, is_available, scraped_at
      FROM benchmarks.snapshots
      WHERE date_checked = ${today}
      ORDER BY facility_id, date_checked, time_slot, court_id, sport, scraped_at DESC
    ) latest
    GROUP BY facility_name, sport
    ORDER BY facility_name, sport
  `);

  const facilityServices = await fetchTodayServices();
  const facilities = mergeFacilities(rows.rows ?? [], facilityServices, (r) => ({
    total: r.total,
    available: r.available,
  }));

  const fields: NonNullable<DiscordEmbed['fields']> = facilities.map((f) => ({
    name: f.facilityName,
    value: f.services.length === 0
      ? EMPTY
      : f.services
          .map((name) => {
            const slug = slugify(name);
            const p = f.bySport.get(slug);
            if (!p) return `\`${slug}\`: mimo sezónu`;
            const pct = p.total > 0 ? Math.round(((p.total - p.available) / p.total) * 100) : 0;
            return `\`${slug}\`: ${p.total} slotů (${p.available} volných, ${pct}% obsazeno)`;
          })
          .join('\n'),
  }));

  const stamp = formatCzechDateTime(new Date());
  const embed: DiscordEmbed = {
    title: `Ranní scrape — ${formatCzechDate(new Date())}`,
    description: fields.length === 0 ? EMPTY : `Posbíráno per sportoviště / sport (${stamp}).`,
    color: pickColor(args.errors.length > 0, args.results),
    fields: fields.length > 0 ? fields : undefined,
    footer: { text: `facilities: ${args.results.length - countFailed(args.results)} ok/${countFailed(args.results)} failed` },
  };

  await sendDiscord({ embeds: [embed] });
  if (args.errors.length > 0) await sendErrorReport({ errors: args.errors, title: 'Ranní scrape — chyby' });
}

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

  const facilityServices = await fetchTodayServices();
  const facilities = mergeFacilities(rows.rows ?? [], facilityServices, (r) => ({
    total: r.total_slots,
    available: r.available_slots,
    booked: r.booked_slots,
    pct: r.occupancy_pct,
    courts: r.courts_count,
  }));

  const fields: NonNullable<DiscordEmbed['fields']> = facilities.map((f) => ({
    name: f.facilityName,
    value: f.services.length === 0
      ? EMPTY
      : f.services
          .map((name) => {
            const slug = slugify(name);
            const p = f.bySport.get(slug);
            return p
              ? `\`${slug}\` — **${p.pct}%** (${p.booked}/${p.total} obsazeno · ${p.courts} kurty)`
              : `\`${slug}\` — mimo sezónu`;
          })
          .join('\n'),
  }));

  const stamp = formatCzechDateTime(new Date());
  const embed: DiscordEmbed = {
    title: `Celodenní shrnutí — ${formatCzechDate(new Date())}`,
    description: fields.length === 0 ? EMPTY : `Obsazenost per sportoviště / sport za celý den (${stamp}).`,
    color: pickColor(args.errors.length > 0, args.results),
    fields: fields.length > 0 ? fields : undefined,
    footer: { text: `facilities: ${args.results.length - countFailed(args.results)} ok/${countFailed(args.results)} failed` },
  };

  await sendDiscord({ embeds: [embed] });
  if (args.errors.length > 0) await sendErrorReport({ errors: args.errors, title: 'Odpolední scrape — chyby' });
}

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
    description: `Zachyceno **${args.errors.length}** chyb (${formatCzechDateTime(new Date())}).`,
    color: COLOR.red,
    fields,
    footer: { text: args.errors.length > 10 ? `+${args.errors.length - 10} dalších v DB` : 'detail: benchmarks.scrape_errors' },
  };

  await sendDiscord({ embeds: [embed] });
}

async function fetchTodayServices(): Promise<Map<string, string[]>> {
  const today = todayInPrague();
  const rows = await db.execute<{ report_json: unknown }>(sql`
    SELECT report_json
    FROM benchmarks.scrape_runs
    WHERE started_at >= ${`${today} 00:00:00`}::timestamptz
      AND started_at <  ${`${today} 00:00:00`}::timestamptz + interval '1 day'
    ORDER BY started_at DESC
  `);

  const map = new Map<string, Set<string>>();
  for (const row of rows.rows ?? []) {
    const report = row.report_json;
    if (!report || typeof report !== 'object') continue;
    const perFacility = (report as { perFacility?: unknown }).perFacility;
    if (!Array.isArray(perFacility)) continue;
    for (const f of perFacility) {
      if (!f || typeof f !== 'object') continue;
      const name = (f as { name?: unknown }).name;
      const services = (f as { services?: unknown }).services;
      if (typeof name !== 'string' || !Array.isArray(services)) continue;
      const set = map.get(name) ?? new Set<string>();
      for (const s of services) {
        if (typeof s === 'string' && s.length > 0) set.add(s);
      }
      map.set(name, set);
    }
  }
  return new Map([...map].map(([k, v]) => [k, [...v]]));
}

function mergeFacilities<Row extends { facility_name: string; sport: string }, Payload>(
  rows: Row[],
  services: Map<string, string[]>,
  toPayload: (r: Row) => Payload,
): FacilityRow<Payload>[] {
  const byName = new Map<string, Map<string, Payload>>();
  for (const r of rows) {
    const inner = byName.get(r.facility_name) ?? new Map<string, Payload>();
    inner.set(r.sport, toPayload(r));
    byName.set(r.facility_name, inner);
  }
  const allNames = new Set<string>([...byName.keys(), ...services.keys()]);
  const out: FacilityRow<Payload>[] = [];
  for (const name of [...allNames].sort((a, b) => a.localeCompare(b, 'cs'))) {
    const bySport = byName.get(name) ?? new Map<string, Payload>();
    const svcList = services.get(name);
    const serviceNames = svcList && svcList.length > 0 ? svcList : [...bySport.keys()];
    out.push({ facilityName: name, bySport, services: serviceNames });
  }
  return out;
}

const CZ_DATE_FMT = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: 'Europe/Prague',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const CZ_DT_FMT = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: 'Europe/Prague',
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatCzechDate(d: Date): string {
  return CZ_DATE_FMT.format(d);
}
function formatCzechDateTime(d: Date): string {
  return CZ_DT_FMT.format(d);
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
