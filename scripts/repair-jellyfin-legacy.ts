import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createJellyfinProvider } from "../src/backend/media/jellyfin";
import { serverUrl } from "../src/backend/media/model";
import { Secret } from "../src/backend/secrets/storage";
import { secretStorage } from "../src/backend/secrets/storage.server";
import { getDatabase } from "../src/db/database";
import { jellyfinProfiles, jellyfinServers } from "../src/db/schema";

const externalId = process.env.JELLYFIN_SERVER_ID;
const rawUrl = process.env.JELLYFIN_URL;
const apiKey = process.env.JELLYFIN_API_KEY;
if (!externalId || !rawUrl || !apiKey) {
	throw new Error(
		"Set JELLYFIN_SERVER_ID, JELLYFIN_URL, and JELLYFIN_API_KEY before running repair.",
	);
}
const url = serverUrl(rawUrl);
const provider = createJellyfinProvider({ clientIdentifier: randomUUID() });
const directory = await provider.directory({ url, token: new Secret(apiKey) });
if (directory.server.id !== externalId)
	throw new Error(
		"The supplied URL and key belong to a different Jellyfin server.",
	);
const { db, client } = getDatabase();
try {
	const count = await db.transaction(async (transaction) => {
		const profiles = await transaction
			.select()
			.from(jellyfinProfiles)
			.where(eq(jellyfinProfiles.serverId, externalId))
			.for("update");
		const [connected] = await transaction
			.select()
			.from(jellyfinServers)
			.where(eq(jellyfinServers.externalId, externalId))
			.limit(1);
		if (
			connected ||
			profiles.length === 0 ||
			profiles.some((profile) => profile.connectionId)
		)
			throw new Error(
				"Repair applies only to an unlinked legacy Jellyfin server.",
			);
		for (const profile of profiles) {
			await transaction
				.update(jellyfinProfiles)
				.set({
					url,
					token: secretStorage.encrypt(profile.id, new Secret(apiKey)),
				})
				.where(eq(jellyfinProfiles.id, profile.id));
		}
		return profiles.length;
	});
	console.log(
		`Replaced credentials on ${count} legacy profiles. Restart Continuarr to backfill the server.`,
	);
} finally {
	await client.end();
}
