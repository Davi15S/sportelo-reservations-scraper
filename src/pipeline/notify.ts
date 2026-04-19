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
  // (slug sport) → payload (agregace z DB)
  bySport: Map<string, Payload>;
  // všechny service names, co Reservanto ohlásil (i bez dnešních dat)
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
    name: f.facilityName,
    value: f.services
      .map((name) => {
        const slug = slugify(name);
        const p = f.bySport.get(slug);
        return p
          ? `\`${slug}\`: ${p.total} slotů (${p.available} volných)`
          : `\`${slug}\`: 0 slotů (mimo sezónu)`;
      })
      .join('\n'),
  }));

  const embed: DiscordEmbed = {
    title: `Ranní scrape — ${today}`,
    description: fields.length === 0 ? EMPTY : `Posbíráno per sportoviště / sport (${today}).`,
    color: pickColor(args.errors.length > 0, args.results),
    fields: fields.length > 0 ? fields : undefined,
    timestamp: new Date().toISOString(),
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
    value: f.services
      .map((name) => {
        const slug = slugify(name);
        const p = f.bySport.get(slug);
        return p
          ? `\`${slug}\` — **${p.pct}%** (${p.booked}/${p.total} obsazeno · ${p.courts} kurty)`
          : `\`${slug}\` — mimo sezónu`;
      })
      .join('\n'),
  }));

  const embed: DiscordEmbed = {
    title: `Celodenní shrnutí — ${today}`,
    description: fields.length === 0 ? EMPTY : 'Obsazenost per sportoviště / sport za celý den.',
    color: pickColor(args.errors.length > 0, args.results),
    fields: fields.length > 0 ? fields : undefined,
    timestamp: new Date().toISOString(),
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
    description: `Zachyceno **${args.errors.length}** chyb.`,
    color: COLOR.red,
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: args.errors.length > 10 ? `+${args.errors.length - 10} dalších v DB` : 'detail: benchmarks.scrape_errors' },
  };

  await sendDiscord({ embeds: [embed] });
}

/**
 * Fetchne všechny (facility_name → service_names[]) z dnešních scrape_runs.
 * Merge přes reporty ranního + odpoledního běhu, takže známe kompletní
 * seznam služeb i pro facility s nulovými dnešními sloty (mimo sezónu).
 */
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
  // Sjednotit facility names z obou zdrojů (snapshots + services list)
  const allNames = new Set<string>([...byName.keys(), ...services.keys()]);
  const out: FacilityRow<Payload>[] = [];
  for (const name of [...allNames].sort()) {
    const bySport = byName.get(name) ?? new Map<string, Payload>();
    const svcList = services.get(name);
    // Pokud známe služby, použij je (i ty s prázdnými daty). Jinak fallback
    // na služby, pro které máme alespoň nějaká data.
    const serviceNames =
      svcList && svcList.length > 0
        ? svcList
        : [...bySport.keys()].map((slug) => slug); // slug sám sobě jako fallback name
    out.push({ facilityName: name, bySport, services: serviceNames });
  }
  return out;
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
