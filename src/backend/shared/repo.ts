import { eq } from "drizzle-orm";
import { getDatabase } from "~/db/database";
import { type ApplicationSetting, applicationSettings } from "~/db/schema";

function findApplicationSetting(key: string): ApplicationSetting | null {
	const { db } = getDatabase();
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

function saveApplicationSetting(key: string, value: string) {
	const { db } = getDatabase();
	return db.insert(applicationSettings).values({ key, value });
}

export { findApplicationSetting, saveApplicationSetting };
