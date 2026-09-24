import { defineConfig } from "drizzle-kit";
import { getDatabaseUrl } from "~/db/config.ts";

export default defineConfig({
	dbCredentials: { url: getDatabaseUrl() },
	dialect: "postgresql",
	out: "./drizzle/postgres",
	schema: "./src/db/schema.ts",
	strict: true,
	verbose: true,
});
