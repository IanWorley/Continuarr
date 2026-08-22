import { defineConfig } from "drizzle-kit";

import { getDatabaseUrl } from "./src/db/config.ts";

export default defineConfig({
	dbCredentials: {
		url: getDatabaseUrl(),
	},
	dialect: "sqlite",
	out: "./drizzle",
	schema: "./src/db/schema.ts",
	strict: true,
	verbose: true,
});
