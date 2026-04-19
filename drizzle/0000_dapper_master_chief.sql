CREATE SCHEMA IF NOT EXISTS "benchmarks";
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."validation_status" AS ENUM('ok', 'anomaly', 'fail');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "benchmarks"."snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" text NOT NULL,
	"facility_name" text NOT NULL,
	"reservation_url" text NOT NULL,
	"sport" text NOT NULL,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"date_checked" date NOT NULL,
	"time_slot" time NOT NULL,
	"court_id" text NOT NULL,
	"is_available" boolean NOT NULL,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "benchmarks"."scrape_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"facilities_total" integer NOT NULL,
	"facilities_ok" integer NOT NULL,
	"facilities_failed" integer NOT NULL,
	"snapshots_written" integer NOT NULL,
	"validation_status" text NOT NULL,
	"validation_notes" text,
	"report_json" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "benchmarks"."daily_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" text NOT NULL,
	"facility_name" text NOT NULL,
	"sport" text NOT NULL,
	"summary_date" date NOT NULL,
	"total_slots" integer NOT NULL,
	"available_slots" integer NOT NULL,
	"booked_slots" integer NOT NULL,
	"occupancy_pct" numeric(5, 2) NOT NULL,
	"courts_count" integer NOT NULL,
	"snapshot_count" integer NOT NULL,
	"last_scraped_at" timestamp with time zone NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "benchmarks"."facilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notion_page_id" text NOT NULL,
	"name" text NOT NULL,
	"reservation_url" text NOT NULL,
	"sport" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_snap_facility_date" ON "benchmarks"."snapshots" USING btree ("facility_id","date_checked");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_snap_scraped_at" ON "benchmarks"."snapshots" USING btree ("scraped_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_summary_facility_sport_date" ON "benchmarks"."daily_summaries" USING btree ("facility_id","sport","summary_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_facility_notion_page" ON "benchmarks"."facilities" USING btree ("notion_page_id");