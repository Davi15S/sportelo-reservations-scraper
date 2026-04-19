-- Nahrazuje sport column (facility-level) za reservation_system. Sport teď
-- žije jen v snapshots + daily_summaries (per-slot z BookingServiceName).
ALTER TABLE "benchmarks"."facilities"
  ADD COLUMN "reservation_system" text NOT NULL DEFAULT 'reservanto';
--> statement-breakpoint
ALTER TABLE "benchmarks"."facilities" ALTER COLUMN "reservation_system" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "benchmarks"."facilities" DROP COLUMN IF EXISTS "sport";
