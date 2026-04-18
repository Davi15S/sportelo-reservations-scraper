import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, db } from "./client";
import { logger } from "../utils/logger";

async function main() {
  logger.info("applying migrations to benchmarks schema");
  await migrate(db, { migrationsFolder: "./drizzle" });
  logger.info("migrations done");
  await closeDb();
}

main().catch((err) => {
  logger.error({ err }, "migration failed");
  process.exit(1);
});
