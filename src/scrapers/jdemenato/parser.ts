import type { SlotSnapshot } from '../types';

/**
 * jdemenato.cz (Tapestry) renderuje rozpis do <table class="verticalTimetable">.
 *   thead th.serviceTop     = název kurtu (jeden per sloupec)
 *   tbody td.timetable{Free|Occupied|Closed|Lesson} + time{N} + timetableTimeRelation{Past|Unspecified|Future}
 *     time{N}  = minuty od půlnoci (time480 = 08:00, krok 30)
 *     rowspan  = víceblokové rezervace (2h = rowspan=4)
 *
 * DOM extrakce běží v browseru (viz index.ts `page.evaluate`), vrací TableSnapshot
 * s `RawCell[][]`. Tady pak čistě v Node z dat postavíme `SlotSnapshot[]`.
 *
 * Pravidla:
 *   - Validní slot = není "Zavřeno" a není v minulosti (`timetableTimeRelationPast`).
 *   - Volný = `timetableFree`; obsazený = `timetableOccupied` / `timetableLesson`.
 */

export type RawCell = {
  status: 'free' | 'occupied' | 'closed' | 'lesson' | null;
  timeMinutes: number | null;
  rowspan: number;
  isPast: boolean;
};

export type TableSnapshot = {
  courts: string[];
  /** Řádky × buňky v pořadí, jak přicházejí z DOMu (bez rowspan rozbalení). */
  rows: RawCell[][];
};

export type BuildSnapshotsInput = {
  table: TableSnapshot;
  dateChecked: string;
  sportName: string | null;
  /** Aktuální čas v Europe/Prague jako minuty od půlnoci. Slot se startem < nowMinutes
   *  (proběhlý nebo právě probíhající) je vyloučen — nelze ho už zarezervovat. */
  nowMinutes: number;
};

/**
 * Rozbalí rowspan do matice [court × 30min-slot] a vrátí SlotSnapshot[].
 * Filtruje minulé sloty + zavřené hodiny + právě probíhající slot (pravidla od uživatele).
 */
export function buildSnapshots({ table, dateChecked, sportName, nowMinutes }: BuildSnapshotsInput): SlotSnapshot[] {
  const out: SlotSnapshot[] = [];
  const sport = sportName ? slugify(sportName) : null;
  const courtCount = table.courts.length;
  const colOffsets = new Array(courtCount).fill(0); // kolik řádků je zabraných předchozím rowspanem per sloupec

  for (const rowCells of table.rows) {
    let tdIdx = 0;
    for (let col = 0; col < courtCount; col++) {
      if (colOffsets[col] > 0) {
        colOffsets[col]--;
        continue;
      }
      const cell = rowCells[tdIdx++];
      if (!cell) break;
      if (cell.status === null || cell.timeMinutes === null) {
        if (cell.rowspan > 1) colOffsets[col] = cell.rowspan - 1;
        continue;
      }
      for (let i = 0; i < cell.rowspan; i++) {
        const timeMinutes = cell.timeMinutes + i * 30;
        if (!isSlotValid(cell, timeMinutes, nowMinutes)) continue;
        out.push({
          dateChecked,
          timeSlot: minutesToTime(timeMinutes),
          courtId: slugify(table.courts[col] ?? `court-${col}`),
          isAvailable: isSlotAvailable(cell.status),
          sport,
        });
      }
      if (cell.rowspan > 1) colOffsets[col] = cell.rowspan - 1;
    }
  }
  return out;
}

function isSlotValid(cell: RawCell, slotStartMinutes: number, nowMinutes: number): boolean {
  // POZOR: nepoužívat cell.isPast (timetableTimeRelationPast) na td — rowspan
  // rezervace překračující now-line mají parent td s timeN v minulosti, ale
  // expandované sloty v budoucnu by byly nesprávně označené jako past. Zdroj
  // pravdy = porovnání slotStart s aktuálním časem v Europe/Prague.
  if (cell.status === 'closed') return false;
  if (slotStartMinutes < nowMinutes) return false;
  return true;
}

function isSlotAvailable(status: RawCell['status']): boolean {
  return status === 'free';
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
