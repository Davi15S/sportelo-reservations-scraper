import type { FacilityScrapeResult } from '../scrapers/types';

const MIN_SUCCESS_RATIO = 0.8;
const MIN_SLOTS_PER_FACILITY = 10;

export function validateRun(results: FacilityScrapeResult[]): {
  status: 'ok' | 'anomaly' | 'fail';
  notes: string | null;
} {
  if (results.length === 0) {
    return { status: 'fail', notes: 'no facilities scraped' };
  }

  const ok = results.filter((r) => r.status === 'ok');
  const ratio = ok.length / results.length;
  const notes: string[] = [];

  if (ratio < MIN_SUCCESS_RATIO) {
    return {
      status: 'fail',
      notes: `success ratio ${(ratio * 100).toFixed(0)}% < ${(MIN_SUCCESS_RATIO * 100).toFixed(0)}%`,
    };
  }

  const thin = ok.filter((r) => r.status === 'ok' && r.snapshots.length < MIN_SLOTS_PER_FACILITY);
  if (thin.length > 0) {
    notes.push(`${thin.length} facility with <${MIN_SLOTS_PER_FACILITY} slots`);
  }

  for (const r of ok) {
    if (r.status !== 'ok' || r.snapshots.length === 0) continue;
    const avail = r.snapshots.filter((s) => s.isAvailable).length;
    const availRatio = avail / r.snapshots.length;
    if (availRatio === 0 || availRatio === 1) {
      notes.push(`${r.facility.name} uniform availability ${(availRatio * 100).toFixed(0)}%`);
    }
  }

  if (notes.length > 0) return { status: 'anomaly', notes: notes.join('; ') };
  return { status: 'ok', notes: null };
}
