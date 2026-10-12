import { describe, expect, it } from "bun:test";
import { DatabaseError } from "pg";
import { jellyfinServers, plexAccounts, plexServers } from "~/db/schema";
import { setupTestDatabase } from "~/db/test-database";

const createTestDatabase = setupTestDatabase();
const JELLYFIN_SERVER = {
	id: "jellyfin-original",
	externalId: "jellyfin-original",
	name: "Jellyfin",
	url: "http://jellyfin:8096",
	token: "encrypted-test-token",
};
const PLEX_ACCOUNT = {
	id: "plex-owner",
	userId: "plex-owner",
	name: "Owner",
	token: "encrypted-test-token",
};
const PLEX_SERVER = {
	accountId: PLEX_ACCOUNT.id,
	name: "Plex",
	url: "http://plex:32400",
};

function postgresErrorCode(error: unknown) {
	if (error instanceof DatabaseError) return error.code;
	if (error instanceof Error && error.cause instanceof DatabaseError)
		return error.cause.code;
	throw error;
}

describe("single media server connection indexes", () => {
	it("rejects a second Jellyfin row and retains the original", async () => {
		const { db } = await createTestDatabase();
		await db.insert(jellyfinServers).values(JELLYFIN_SERVER);
		const errorCode = await db
			.insert(jellyfinServers)
			.values({
				...JELLYFIN_SERVER,
				id: "jellyfin-second",
				externalId: "jellyfin-second",
			})
			.execute()
			.then(() => null, postgresErrorCode);
		expect({
			errorCode,
			servers: await db
				.select({ externalId: jellyfinServers.externalId })
				.from(jellyfinServers),
		}).toEqual({
			errorCode: "23505",
			servers: [{ externalId: "jellyfin-original" }],
		});
	});

	it("retains two unverified Plex candidates but rejects a second verified row", async () => {
		const { db } = await createTestDatabase();
		await db.insert(plexAccounts).values(PLEX_ACCOUNT);
		await db.insert(plexServers).values([
			{ ...PLEX_SERVER, id: "candidate-a", externalId: "candidate-a" },
			{ ...PLEX_SERVER, id: "candidate-b", externalId: "candidate-b" },
		]);
		await db.insert(plexServers).values({
			...PLEX_SERVER,
			id: "verified-original",
			externalId: "verified-original",
			verified: true,
		});
		const errorCode = await db
			.insert(plexServers)
			.values({
				...PLEX_SERVER,
				id: "verified-second",
				externalId: "verified-second",
				verified: true,
			})
			.execute()
			.then(() => null, postgresErrorCode);
		expect({
			errorCode,
			servers: await db
				.select({
					externalId: plexServers.externalId,
					verified: plexServers.verified,
				})
				.from(plexServers)
				.orderBy(plexServers.externalId),
		}).toEqual({
			errorCode: "23505",
			servers: [
				{ externalId: "candidate-a", verified: false },
				{ externalId: "candidate-b", verified: false },
				{ externalId: "verified-original", verified: true },
			],
		});
	});
});
