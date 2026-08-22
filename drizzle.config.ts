import { defineConfig } from "drizzle-kit";

import { ensureDatabaseDirectory } from "~/db/config.ts";

export default defineConfig({
	dbCredentials: {
		url: ensureDatabaseDirectory(),
	},
	dialect: "sqlite",
	out: "./drizzle",
	schema: "./src/db/schema.ts",
	strict: true,
	verbose: true,
});
