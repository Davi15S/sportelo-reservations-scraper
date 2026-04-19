import type { SlotSnapshot } from '../types';

/**
 * Reservanto widget vloží inline <script> uvnitř iframu obsahující:
 *   var model = new DailyHorizotalCalendar({ days: [ ...JSON... ], ... });
 * Scraper najde tento script a vytáhne pole `days:` – je to zdroj pravdy
 * se všemi sloty viditelného týdne (žádný separátní JSON endpoint).
 */

type ReservantoDay = {
  dayFormatted?: string;
  locations?: ReservantoLocation[];
};

type ReservantoLocation = {
  id?: number | string;
  name?: string;
  sources?: ReservantoSource[];
};

type ReservantoSource = {
  id?: number | string;
  name?: string;
  availability?: ReservantoAvailability[];
};

type ReservantoAvailability = {
  StartTime?: string;
  EndTime?: string;
  IsFree?: boolean;
  CanBeBooked?: boolean;
  AppointmentModel?: {
    Availability?: string;
    FreeCapacity?: number;
    BookingServiceName?: string;
  };
};

export function extractDaysJson(scripts: string[]): ReservantoDay[] | null {
  for (const src of scripts) {
    const idx = src.indexOf('days:');
    if (idx < 0) continue;
    const arrStart = src.indexOf('[', idx);
    if (arrStart < 0) continue;
    const arrEnd = findBalancedEnd(src, arrStart);
    if (arrEnd < 0) continue;
    const raw = src.slice(arrStart, arrEnd + 1);
    try {
      return JSON.parse(raw) as ReservantoDay[];
    } catch {
      continue;
    }
  }
  return null;
}

function findBalancedEnd(src: string, openIdx: number): number {
  let depth = 0;
  let inString = false;
  let stringChar = '';
  let escaped = false;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === stringChar) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function daysToSnapshots(days: ReservantoDay[]): SlotSnapshot[] {
  const out: SlotSnapshot[] = [];
  for (const day of days) {
    for (const loc of day.locations ?? []) {
      for (const src of loc.sources ?? []) {
        const courtId = String(src.id ?? src.name ?? '').trim();
        if (!courtId) continue;
        for (const av of src.availability ?? []) {
          if (!av.StartTime) continue;
          const dateChecked = av.StartTime.slice(0, 10);
          const timeSlot = `${av.StartTime.slice(11, 19)}`;
          if (dateChecked.length !== 10 || timeSlot.length !== 8) continue;
          out.push({
            dateChecked,
            timeSlot,
            courtId,
            isAvailable: isSlotAvailable(av),
            sport: detectSport(av, src),
          });
        }
      }
    }
  }
  return out;
}

/**
 * Sport per slot = slug z Reservanto `BookingServiceName`. Multi-sport
 * sportoviště (např. Padel Neride) vracejí 3+ různé služby ("Padle tenis -
 * hala zima", "Padel tenis - hala léto", "Tenis hala"). Každá se ukládá
 * jako samostatný sport, takže `daily_summaries` dá per-službu rollup.
 *
 * Fallback: název zdroje (kurtu). Pokud ani jedno → null → pipeline použije
 * facility.sport z Notion (monosport sportoviště).
 */
function detectSport(av: ReservantoAvailability, src: ReservantoSource): string | null {
  const raw = av.AppointmentModel?.BookingServiceName ?? src.name ?? null;
  if (!raw) return null;
  return slugify(raw);
}

function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics (ě, á, í, …)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isSlotAvailable(av: ReservantoAvailability): boolean {
  if (av.AppointmentModel) {
    const status = (av.AppointmentModel.Availability ?? '').toLowerCase();
    if (['obsazeno', 'reserved', 'booked', 'zavřeno', 'zavreno', 'closed'].includes(status)) return false;
    if (typeof av.AppointmentModel.FreeCapacity === 'number') return av.AppointmentModel.FreeCapacity > 0;
  }
  if (typeof av.CanBeBooked === 'boolean') return av.CanBeBooked;
  if (typeof av.IsFree === 'boolean') return av.IsFree;
  return false;
}
