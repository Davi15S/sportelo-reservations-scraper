import type { FacilityScrapeResult } from '../scrapers/types';

export type RunReport = {
  startedAt: string;
  finishedAt: string;
  facilitiesTotal: number;
  facilitiesOk: number;
  facilitiesFailed: number;
  snapshotsWritten: number;
  validation: {
    status: 'ok' | 'anomaly' | 'fail';
    notes: string | null;
  };
  perFacility: Array<{
    id: string;
    name: string;
    url: string;
    status: 'ok' | 'failed';
    snapshotCount: number;
    /** Raw service names detekované na platformě (před slugify). */
    services: string[];
    error?: string;
  }>;
};

function extractServices(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const services = (raw as { services?: unknown }).services;
  if (!Array.isArray(services)) return [];
  return services.filter((s): s is string => typeof s === 'string' && s.length > 0);
}

export function buildReport(args: {
  startedAt: Date;
  results: FacilityScrapeResult[];
  snapshotsWritten: number;
  validationStatus: 'ok' | 'anomaly' | 'fail';
  validationNotes: string | null;
}): RunReport {
  const ok = args.results.filter((r) => r.status === 'ok').length;
  const failed = args.results.length - ok;

  return {
    startedAt: args.startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    facilitiesTotal: args.results.length,
    facilitiesOk: ok,
    facilitiesFailed: failed,
    snapshotsWritten: args.snapshotsWritten,
    validation: { status: args.validationStatus, notes: args.validationNotes },
    perFacility: args.results.map((r) => ({
      id: r.facility.id,
      name: r.facility.name,
      url: r.facility.reservationUrl,
      status: r.status,
      snapshotCount: r.status === 'ok' ? r.snapshots.length : 0,
      services: r.status === 'ok' ? extractServices(r.rawSample) : [],
      ...(r.status === 'failed' ? { error: r.error } : {}),
    })),
  };
}

