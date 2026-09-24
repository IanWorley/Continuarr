import { eq } from "drizzle-orm";
import { type AppDatabase, getDatabase } from "~/db/database";
import { type ApplicationSetting, applicationSettings } from "~/db/schema";

async function findApplicationSetting(
	key: string,
	db: AppDatabase = getDatabase().db,
): Promise<ApplicationSetting | null> {
	const [setting] = await db
		.select()
		.from(applicationSettings)
		.where(eq(applicationSettings.key, key))
		.limit(1);
	return setting ?? null;
}

async function saveApplicationSetting(
	key: string,
	value: string,
	db: AppDatabase = getDatabase().db,
): Promise<ApplicationSetting> {
	const [setting] = await db
		.insert(applicationSettings)
		.values({ key, value })
		.onConflictDoUpdate({
			target: applicationSettings.key,
			set: { value, updatedAt: new Date() },
		})
		.returning();
	if (!setting) throw new Error("Unable to save application setting.");
	return setting;
}

async function getOrCreateApplicationSetting(
	key: string,
	value: string,
	db: AppDatabase = getDatabase().db,
): Promise<ApplicationSetting> {
	const [created] = await db
		.insert(applicationSettings)
		.values({ key, value })
		.onConflictDoNothing()
		.returning();
	if (created) return created;
	const existing = await findApplicationSetting(key, db);
	if (!existing) throw new Error("Unable to read application setting.");
	return existing;
}

export {
	findApplicationSetting,
	getOrCreateApplicationSetting,
	saveApplicationSetting,
};
