import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { COLOR, sendDiscord, type DiscordEmbed } from '../notifications/discord';
import { slugify } from '../scrapers/reservanto/parser';
import { todayInPrague } from '../utils/date';
import type { FacilityScrapeResult } from '../scrapers/types';
import type { PendingError } from './errors';

const EMPTY = '_(žádná data)_';

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
    FROM benchmarks.snapshots
    WHERE date_checked = ${today}
    GROUP BY facility_name, sport
    ORDER BY facility_name, sport
  `);

  const facilityServices = await fetchTodayServices();
  const facilities = mergeFacilities(rows.rows ?? [], facilityServices, (r) => ({
    total: r.total,
    available: r.available,
  }));

  const fields: NonNullable<DiscordEmbed['fields']> = facilities.map((f) => ({
    name: `🏟️  ${f.facilityName}`,
    value: f.services.length === 0 ? EMPTY : f.services.map((name) => renderMorningLine(name, f.bySport)).join('\n'),
  }));

  const totalSlots = sumBy(facilities, (f) => [...f.bySport.values()].reduce((acc, p) => acc + p.total, 0));
  const totalFree = sumBy(facilities, (f) => [...f.bySport.values()].reduce((acc, p) => acc + p.available, 0));
  const servicesTracked = sumBy(facilities, (f) => f.bySport.size);

  const embed: DiscordEmbed = {
    title: `🌅 Ranní scrape — ${formatCzechDate(new Date())}`,
    description: [
      `⏱ Běh dokončen v **${formatCzechTime(new Date())}** (Europe/Prague)`,
      `📊 Posbíráno **${totalSlots}** slotů · **${totalFree}** volných · ${servicesTracked} aktivních služeb`,
    ].join('\n'),
    color: pickColor(args.errors.length > 0, args.results),
    fields: fields.length > 0 ? fields : undefined,
    footer: {
      text: `${args.results.length - countFailed(args.results)}/${args.results.length} sportovišť OK${args.errors.length > 0 ? ` · ${args.errors.length} chyb` : ''}`,
    },
  };

  await sendDiscord({ embeds: [embed] });
  if (args.errors.length > 0) await sendErrorReport({ errors: args.errors, title: '🚨 Ranní scrape — chyby' });
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
    pct: Number(r.occupancy_pct),
    courts: r.courts_count,
  }));

  const fields: NonNullable<DiscordEmbed['fields']> = facilities.map((f) => ({
    name: `🏟️  ${f.facilityName}`,
    value: f.services.length === 0 ? EMPTY : f.services.map((name) => renderAfternoonLine(name, f.bySport)).join('\n'),
  }));

  const allPayloads = facilities.flatMap((f) => [...f.bySport.values()]);
  const avgOccupancy = allPayloads.length > 0
    ? Math.round((allPayloads.reduce((acc, p) => acc + p.pct, 0) / allPayloads.length) * 10) / 10
    : 0;
  const totalSlots = allPayloads.reduce((acc, p) => acc + p.total, 0);
  const totalBooked = allPayloads.reduce((acc, p) => acc + p.booked, 0);

  const embed: DiscordEmbed = {
    title: `🌇 Celodenní shrnutí — ${formatCzechDate(new Date())}`,
    description: [
      `⏱ Uzavřeno v **${formatCzechTime(new Date())}** (Europe/Prague)`,
      `📊 **${totalBooked}/${totalSlots}** slotů obsazeno · průměrná obsazenost **${avgOccupancy}%**`,
    ].join('\n'),
    color: pickColor(args.errors.length > 0, args.results),
    fields: fields.length > 0 ? fields : undefined,
    footer: {
      text: `${args.results.length - countFailed(args.results)}/${args.results.length} sportovišť OK${args.errors.length > 0 ? ` · ${args.errors.length} chyb` : ''}`,
    },
  };

  await sendDiscord({ embeds: [embed] });
  if (args.errors.length > 0) await sendErrorReport({ errors: args.errors, title: '🚨 Odpolední scrape — chyby' });
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
    description: [
      `⏱ **${formatCzechDateTime(new Date())}** (Europe/Prague)`,
      `Zachyceno **${args.errors.length}** chyb během běhu.`,
    ].join('\n'),
    color: COLOR.red,
    fields,
    footer: {
      text: args.errors.length > 10 ? `+${args.errors.length - 10} dalších · detail: benchmarks.scrape_errors` : 'detail: benchmarks.scrape_errors',
    },
  };

  await sendDiscord({ embeds: [embed] });
}

function renderMorningLine(name: string, bySport: Map<string, { total: number; available: number }>): string {
  const slug = slugify(name);
  const p = bySport.get(slug);
  if (!p) return `💤  **${name}** — mimo sezónu`;
  const pct = p.total > 0 ? Math.round(((p.total - p.available) / p.total) * 100) : 0;
  return `🎾  **${name}** — ${p.total} slotů · **${p.available} volných** (obsazenost ${pct} %)`;
}

function renderAfternoonLine(
  name: string,
  bySport: Map<string, { total: number; available: number; booked: number; pct: number; courts: number }>,
): string {
  const slug = slugify(name);
  const p = bySport.get(slug);
  if (!p) return `💤  **${name}** — mimo sezónu`;
  return `🎾  **${name}** — **${p.pct} %** obsazeno (${p.booked}/${p.total} slotů · ${p.courts} kurty)`;
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
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const CZ_TIME_FMT = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: 'Europe/Prague',
  hour: '2-digit',
  minute: '2-digit',
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
function formatCzechTime(d: Date): string {
  return CZ_TIME_FMT.format(d);
}
function formatCzechDateTime(d: Date): string {
  return CZ_DT_FMT.format(d);
}

function sumBy<T>(items: T[], get: (t: T) => number): number {
  return items.reduce((acc, it) => acc + get(it), 0);
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
