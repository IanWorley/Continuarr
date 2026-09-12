import { eq } from "drizzle-orm";
import { getDatabase } from "~/db/database";
import { type ApplicationSetting, applicationSettings } from "~/db/schema";

type Database = ReturnType<typeof getDatabase>["db"];

function findApplicationSetting(
	key: string,
	db: Database = getDatabase().db,
): ApplicationSetting | null {
	const result = db
		.select()
		.from(applicationSettings)
		.where(eq(applicationSettings.key, key))
		.limit(1)
		.get();

	if (!result) {
		return null;
	}

	return result;
}

function saveApplicationSetting(
	key: string,
	value: string,
	db: Database = getDatabase().db,
): ApplicationSetting {
	return db
		.insert(applicationSettings)
		.values({ key, value })
		.onConflictDoUpdate({
			target: applicationSettings.key,
			set: { value },
		})
		.returning()
		.get();
}

export { findApplicationSetting, saveApplicationSetting };
