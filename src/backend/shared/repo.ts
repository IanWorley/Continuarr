import { eq } from "drizzle-orm";
import { type DatabaseConnection, getDatabase } from "~/db/database";
import { type ApplicationSetting, applicationSettings } from "~/db/schema";

export interface ApplicationSettingsRepository {
	findApplicationSetting: (
		key: string,
	) => Pick<ApplicationSetting, "value"> | null;
	saveApplicationSetting: (key: string, value: string) => void;
}

export function createApplicationSettingsRepository({
	db,
}: DatabaseConnection): ApplicationSettingsRepository {
	return {
		findApplicationSetting(key) {
			return (
				db
					.select()
					.from(applicationSettings)
					.where(eq(applicationSettings.key, key))
					.limit(1)
					.get() ?? null
			);
		},
		saveApplicationSetting(key, value) {
			db.insert(applicationSettings).values({ key, value }).run();
		},
	};
}

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
	return db.insert(applicationSettings).values({ key, value }).run();
}

export { findApplicationSetting, saveApplicationSetting };
