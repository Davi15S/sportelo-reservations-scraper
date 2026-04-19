CREATE TABLE IF NOT EXISTS "benchmarks"."scrape_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fingerprint" text NOT NULL,
	"scrape_run_id" uuid,
	"facility_id" uuid,
	"facility_name" text,
	"reservation_url" text,
	"platform" text,
	"stage" text NOT NULL,
	"error_type" text NOT NULL,
	"error_message" text NOT NULL,
	"error_stack" text,
	"context" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolved_note" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "benchmarks"."scrape_errors" ADD CONSTRAINT "scrape_errors_scrape_run_id_scrape_runs_id_fk" FOREIGN KEY ("scrape_run_id") REFERENCES "benchmarks"."scrape_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "benchmarks"."scrape_errors" ADD CONSTRAINT "scrape_errors_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "benchmarks"."facilities"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_errors_fingerprint" ON "benchmarks"."scrape_errors" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_errors_resolved" ON "benchmarks"."scrape_errors" USING btree ("resolved");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_errors_run" ON "benchmarks"."scrape_errors" USING btree ("scrape_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_errors_facility" ON "benchmarks"."scrape_errors" USING btree ("facility_id");