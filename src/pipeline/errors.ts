import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { scrapeErrors, type NewScrapeError } from '../db/schema/scrape-errors';

export type ErrorStage = 'bootstrap' | 'sync' | 'scrape' | 'parse' | 'insert' | 'validate' | 'summary';
export type ErrorType = 'network' | 'timeout' | 'parse' | 'validation' | 'db' | 'unexpected';

export type PendingError = {
  stage: ErrorStage;
  errorType: ErrorType;
  errorMessage: string;
  errorStack: string | null;
  facilityId: string | null;
  facilityName: string | null;
  reservationUrl: string | null;
  platform: string | null;
  context: Record<string, unknown> | null;
};

/** Normalize raw error into pending record. Fingerprint computed at persist time. */
export function normalizeError(args: {
  stage: ErrorStage;
  err: unknown;
  facility?: { id: string; name: string; reservationUrl: string } | null;
  platform?: string | null;
  errorType?: ErrorType;
  context?: Record<string, unknown> | null;
}): PendingError {
  const raw = args.err;
  const isError = raw instanceof Error;
  const message = isError ? raw.message : String(raw);
  const stack = isError ? raw.stack ?? null : null;
  const errorType: ErrorType = args.errorType ?? classifyError(message, stack);

  return {
    stage: args.stage,
    errorType,
    errorMessage: message.slice(0, 4000),
    errorStack: stack?.slice(0, 8000) ?? null,
    facilityId: args.facility?.id ?? null,
    facilityName: args.facility?.name ?? null,
    reservationUrl: args.facility?.reservationUrl ?? null,
    platform: args.platform ?? null,
    context: args.context ?? null,
  };
}

function classifyError(message: string, stack: string | null): ErrorType {
  const blob = `${message}\n${stack ?? ''}`.toLowerCase();
  if (/timeout|timed out|exceeded.*timeout/.test(blob)) return 'timeout';
  if (/econnrefused|enotfound|etimedout|socket hang up|fetch failed|network/.test(blob)) return 'network';
  if (/json\.parse|syntax error|unexpected token|parse error|extractdaysjson/.test(blob)) return 'parse';
  if (/postgres|relation ".+" does not exist|sql|drizzle/.test(blob)) return 'db';
  return 'unexpected';
}

/**
 * Fingerprint = SHA1(stage | facilityId | normalized message).
 * Normalize: lowercase, strip digits/UUIDs/paths to remove volatility between runs.
 */
export function computeFingerprint(err: PendingError): string {
  const normalized = err.errorMessage
    .toLowerCase()
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, '<uuid>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha1')
    .update(`${err.stage}|${err.facilityId ?? ''}|${normalized}`)
    .digest('hex');
}

/**
 * Upsert logic:
 * - If an OPEN (resolved=false) row with same fingerprint exists → bump last_seen_at,
 *   occurrence_count, refresh context + stack + scrape_run_id.
 * - Else insert a new row (this includes cases where previous row exists but resolved=true —
 *   user already marked it fixed, new occurrence is a regression).
 */
export async function upsertScrapeErrors(errors: PendingError[], scrapeRunId: string | null): Promise<number> {
  if (errors.length === 0) return 0;
  let count = 0;
  for (const err of errors) {
    const fingerprint = computeFingerprint(err);
    const [open] = await db
      .select({ id: scrapeErrors.id })
      .from(scrapeErrors)
      .where(and(eq(scrapeErrors.fingerprint, fingerprint), eq(scrapeErrors.resolved, false)))
      .limit(1);

    if (open) {
      await db
        .update(scrapeErrors)
        .set({
          lastSeenAt: new Date(),
          occurrenceCount: sql`${scrapeErrors.occurrenceCount} + 1`,
          errorStack: err.errorStack,
          context: err.context ?? null,
          scrapeRunId,
        })
        .where(eq(scrapeErrors.id, open.id));
    } else {
      const row: NewScrapeError = {
        fingerprint,
        scrapeRunId,
        facilityId: err.facilityId,
        facilityName: err.facilityName,
        reservationUrl: err.reservationUrl,
        platform: err.platform,
        stage: err.stage,
        errorType: err.errorType,
        errorMessage: err.errorMessage,
        errorStack: err.errorStack,
        context: err.context ?? null,
      };
      await db.insert(scrapeErrors).values(row);
    }
    count++;
  }
  return count;
}

/** Alias for run.ts — keeps old call site simple. */
export const flushErrors = upsertScrapeErrors;
