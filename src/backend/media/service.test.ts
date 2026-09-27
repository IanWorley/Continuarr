import { describe, expect, it } from "bun:test";
import { setImmediate } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { createAdministratorService } from "~/backend/admin/service";
import { createApi } from "~/backend/api";
import { createSecretStorage, Secret } from "~/backend/secrets/storage";
import * as schema from "~/db/schema";
import { setupTestDatabase } from "~/db/test-database";
import {
	type JellyfinDirectory,
	type JellyfinProvider,
	MediaError,
	type MediaItem,
	type PlexProvider,
} from "./model";
import { createMediaRepository } from "./repo";
import { createMediaService } from "./service";

const createTestDatabase = setupTestDatabase();
const movie = (id: string, watched: boolean): MediaItem => ({
	id,
	kind: "movie",
	title: "Arrival",
	ids: [{ provider: "tmdb", value: "329865" }],
	watched,
});
async function setup(now: () => number = Date.now) {
	const { db, client } = await createTestDatabase();
	const repo = createMediaRepository(() => db);
	const secrets = createSecretStorage(Buffer.alloc(32, 7).toString("base64"));
	const state = {
		plex: [movie("p1", true)],
		jellyfin: [movie("j1", false)],
		failRead: false,
		failWrite: false,
		plexLogin: {
			userId: "owner",
			name: "Owner",
			token: new Secret("owner-token"),
		},
		grant: true,
		failDirectory: false,
		writes: [] as string[],
	};
	const plex: PlexProvider = {
		startLogin: async () => ({
			id: 123,
			code: "code",
			expiresIn: 600,
			authorizationUrl: "https://app.plex.tv/auth/",
		}),
		pollLogin: async () => state.plexLogin,
		homeUsers: async () => [{ id: "child", name: "Child", protected: true }],
		directory: async () => {
			if (state.failDirectory)
				throw new MediaError("Plex directory failed.", 502);
			return [
				{ id: "owner", name: "Owner", access: { kind: "owner" as const } },
				{
					id: "child",
					name: "Child",
					access: state.grant
						? {
								kind: "shared_grant" as const,
								token: new Secret("child-token-server"),
							}
						: { kind: "unavailable" as const },
				},
			];
		},
		servers: async (token) => [
			{
				id: "machine",
				name: "Plex",
				token: new Secret(`${token.reveal()}-server`),
				connections: ["http://plex:32400"],
			},
		],
		verifyServer: async () => {},
		items: async (access) => {
			expect(access.token.reveal()).toBe("child-token-server");
			return state.plex;
		},
		markWatched: async (_access, id) => {
			state.writes.push(`plex:${id}`);
			state.plex = state.plex.map((item) =>
				item.id === id ? { ...item, watched: true } : item,
			);
		},
	};
	const jellyfin: JellyfinProvider = {
		directory: async () => ({
			server: { id: "j-server", name: "Jellyfin" },
			users: [
				{
					id: "j-child",
					name: "Child",
					disabled: false,
					administrator: false,
					lastActivityDate: null,
					lastLoginDate: null,
					details: { Id: "j-child", Name: "Child" },
				},
			],
		}),
		items: async (access) => {
			expect(access.userId).toBe("j-child");
			if (state.failRead) throw new MediaError("Library read failed.", 502);
			return state.jellyfin;
		},
		markWatched: async (access, id) => {
			expect(access.token.reveal()).toBe("j-token");
			if (state.failWrite) throw new MediaError("Write failed.", 502);
			state.writes.push(`jellyfin:${id}`);
			state.jellyfin = state.jellyfin.map((item) =>
				item.id === id ? { ...item, watched: true } : item,
			);
		},
	};
	const service = createMediaService({ repo, secrets, plex, jellyfin, now });
	async function pair() {
		const attempt = await service.startLogin();
		const login = await service.pollLogin(attempt.id);
		if (login.status !== "linked") throw new Error("Expected linked account");
		const selection = await service.selectPlexServer({
			accountId: login.accountId,
		});
		await service.connectPlex({
			selectionId: selection.id,
			serverId: "machine",
			url: "http://plex:32400",
		});
		await service.importJellyfin({
			kind: "new",
			url: "http://jellyfin:8096",
			apiKey: "j-token",
		});
		const j = (await repo.jellyfinProfiles())[0];
		if (!j) throw new Error("Missing Jellyfin profile");
		const child = (await repo.plexProfiles()).find(
			(profile) => profile.userId === "child",
		);
		if (!child) throw new Error("Missing Plex child profile");
		return service.addPairing({
			plexProfileId: child.id,
			jellyfinProfileId: j.id,
		});
	}
	return {
		db,
		databaseUrl: client.options.connectionString ?? "",
		repo,
		secrets,
		service,
		state,
		pair,
		plex,
		jellyfin,
	};
}

describe("media account and sync service", () => {
	it("imports owner and granted Home user without a PIN and exposes no token", async () => {
		const { service, repo, pair } = await setup();
		const pairing = await pair();
		const profiles = await repo.plexProfiles();
		expect(
			profiles.map(({ userId, accessStatus }) => [userId, accessStatus]).sort(),
		).toEqual([
			["child", "available"],
			["owner", "available"],
		]);
		expect(
			(await repo.plexProfile(pairing.plexProfileId))?.token?.startsWith("v1:"),
		).toBe(true);
		expect(JSON.stringify(await service.state())).not.toMatch(
			/owner-token|child-token|j-token|v1:/,
		);
	});
	it("keeps the last good Plex snapshot on failure and revokes a missing grant after a complete refresh", async () => {
		const { service, repo, state, pair } = await setup();
		const pairing = await pair();
		const server = (await repo.plexServers())[0];
		if (!server) throw new Error("Missing Plex server");
		state.failDirectory = true;
		expect((await service.refreshPlexUsers(server.id)).kind).toBe("failed");
		expect((await repo.plexProfile(pairing.plexProfileId))?.accessStatus).toBe(
			"available",
		);
		state.failDirectory = false;
		state.grant = false;
		expect((await service.refreshPlexUsers(server.id)).kind).toBe("updated");
		expect((await repo.plexProfile(pairing.plexProfileId))?.accessStatus).toBe(
			"unavailable",
		);
		await expect(service.preview(pairing.id)).rejects.toThrow(
			"no server grant",
		);
	});
	it("keeps an unadopted legacy profile usable, then marks absent legacy users missing on verified adoption", async () => {
		const { service, repo, secrets, state } = await setup();
		const attempt = await service.startLogin();
		const login = await service.pollLogin(attempt.id);
		if (login.status !== "linked") throw new Error("Expected login");
		const legacyId = crypto.randomUUID();
		await repo.savePlexProfile({
			id: legacyId,
			accountId: login.accountId,
			userId: "old-user",
			name: "Old user",
			serverId: "machine",
			serverName: "Plex",
			url: "http://plex:32400",
			token: secrets.encrypt(legacyId, new Secret("legacy-token")),
		});
		await repo.backfillPlexServers();
		expect((await repo.plexProfile(legacyId))?.connectionId).toBeNull();
		expect(
			secrets
				.decrypt(legacyId, (await repo.plexProfile(legacyId))?.token ?? "")
				.reveal(),
		).toBe("legacy-token");
		const selection = await service.selectPlexServer({
			accountId: login.accountId,
		});
		await service.connectPlex({
			selectionId: selection.id,
			serverId: "machine",
			url: "http://plex:32400",
		});
		expect((await repo.plexProfile(legacyId))?.presence).toBe("missing");
		expect((await repo.plexProfile(legacyId))?.accessStatus).toBe(
			"unavailable",
		);
		expect((await repo.plexProfile(legacyId))?.connectionId).toBe(
			(await repo.plexServers())[0]?.id,
		);
		expect(state.writes).toEqual([]);
	});
	it("lets the verified owner take over an unverified candidate from a shared account", async () => {
		const { service, repo, secrets, state, plex } = await setup();
		const firstAttempt = await service.startLogin();
		const firstLogin = await service.pollLogin(firstAttempt.id);
		if (firstLogin.status !== "linked")
			throw new Error("Missing first account");
		const candidateId = crypto.randomUUID();
		await repo.savePlexProfile({
			id: candidateId,
			accountId: firstLogin.accountId,
			userId: "owner",
			name: "Owner",
			serverId: "machine",
			serverName: "Plex",
			url: "http://plex:32400",
			token: secrets.encrypt(candidateId, new Secret("old-token")),
		});
		await repo.backfillPlexServers();
		const candidate = (await repo.plexServers())[0];
		expect(candidate?.verified).toBe(false);
		state.plexLogin = {
			userId: "real-owner",
			name: "Real owner",
			token: new Secret("real-owner-token"),
		};
		const ownerAttempt = await service.startLogin();
		const ownerLogin = await service.pollLogin(ownerAttempt.id);
		if (ownerLogin.status !== "linked")
			throw new Error("Missing owner account");
		plex.directory = async () => [
			{ id: "real-owner", name: "Real owner", access: { kind: "owner" } },
		];
		const selection = await service.selectPlexServer({
			accountId: ownerLogin.accountId,
		});
		await service.connectPlex({
			selectionId: selection.id,
			serverId: "machine",
			url: "http://plex:32400",
		});
		expect((await repo.plexServers())[0]).toMatchObject({
			id: candidate?.id,
			accountId: ownerLogin.accountId,
			verified: true,
		});
		expect((await repo.plexProfile(candidateId))?.presence).toBe("missing");
	});
	it("rejects an old refresh after owner reauthorization", async () => {
		const { service, repo, secrets, state, plex, pair } = await setup();
		const pairing = await pair();
		const server = (await repo.plexServers())[0];
		if (!server) throw new Error("Missing server");
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		plex.directory = async () => {
			await gate;
			return [{ id: "owner", name: "Owner", access: { kind: "owner" } }];
		};
		const oldRefresh = service.refreshPlexUsers(server.id);
		state.plexLogin = {
			userId: "owner",
			name: "Owner",
			token: new Secret("new-owner-token"),
		};
		const attempt = await service.startLogin();
		await service.pollLogin(attempt.id);
		release?.();
		expect((await oldRefresh).kind).toBe("superseded");
		expect((await repo.plexProfile(pairing.plexProfileId))?.accessStatus).toBe(
			"available",
		);
		const owner = (await repo.plexProfiles()).find(
			(profile) => profile.userId === "owner",
		);
		expect(secrets.decrypt(owner?.id ?? "", owner?.token ?? "").reveal()).toBe(
			"new-owner-token",
		);
	});
	it("rejects a stale overlapping reconnect before it can replace newer grants", async () => {
		const { service, repo, plex, pair } = await setup();
		await pair();
		const accountId = (await repo.accounts())[0]?.id;
		if (!accountId) throw new Error("Missing account");
		const first = await service.selectPlexServer({ accountId });
		const second = await service.selectPlexServer({ accountId });
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let requests = 0;
		plex.directory = async () => {
			requests++;
			if (requests === 1) await gate;
			return [{ id: "owner", name: "Owner", access: { kind: "owner" } }];
		};
		const stale = service.connectPlex({
			selectionId: first.id,
			serverId: "machine",
			url: "http://plex:32400",
		});
		while (requests === 0) await Bun.sleep(1);
		await service.connectPlex({
			selectionId: second.id,
			serverId: "machine",
			url: "http://plex:32400",
		});
		release?.();
		await expect(stale).rejects.toThrow("connection changed");
	});
	it("imports every user and retains the full details", async () => {
		const { service, jellyfin, repo } = await setup();
		jellyfin.directory = async (): Promise<JellyfinDirectory> => ({
			server: { id: "j-server", name: "Jellyfin" },
			users: [
				{
					id: "dad",
					name: "Dad",
					disabled: false,
					administrator: true,
					lastActivityDate: null,
					lastLoginDate: null,
					details: {
						Id: "dad",
						Name: "Dad",
						Policy: { IsAdministrator: true },
						Custom: [1, 2],
					},
				},
				{
					id: "mom",
					name: "Mom",
					disabled: true,
					administrator: false,
					lastActivityDate: null,
					lastLoginDate: null,
					details: { Id: "mom", Name: "Mom", Policy: { IsDisabled: true } },
				},
			],
		});
		await service.importJellyfin({
			kind: "new",
			url: "http://jellyfin:8096",
			apiKey: "j-token",
		});
		expect(
			(await service.jellyfinDirectory()).users.map((user) => ({
				name: user.name,
				details: user.userDetails,
				disabled: user.disabled,
			})),
		).toEqual([
			{
				name: "Dad",
				details: {
					Id: "dad",
					Name: "Dad",
					Policy: { IsAdministrator: true },
					Custom: [1, 2],
				},
				disabled: false,
			},
			{
				name: "Mom",
				details: { Id: "mom", Name: "Mom", Policy: { IsDisabled: true } },
				disabled: true,
			},
		]);
		expect(await repo.jellyfinServers()).toHaveLength(1);
	});

	it("keeps stable users and pairings when later snapshots omit users or fail", async () => {
		const { service, repo, jellyfin, pair } = await setup();
		const pairing = await pair();
		const originalId = pairing.jellyfinProfileId;
		jellyfin.directory = async () => ({
			server: { id: "j-server", name: "Jellyfin" },
			users: [],
		});
		const server = (await repo.jellyfinServers())[0];
		if (!server) throw new Error("Missing server");
		expect(await service.refreshJellyfinUsers(server.id)).toEqual({
			kind: "updated",
			importedCount: 0,
		});
		expect((await repo.jellyfinProfile(originalId))?.presence).toBe("missing");
		expect((await repo.pairing(pairing.id))?.jellyfinProfileId).toBe(
			originalId,
		);
		jellyfin.directory = async () => {
			throw new MediaError("The media server request failed.", 502);
		};
		expect(await service.refreshJellyfinUsers(server.id)).toEqual({
			kind: "failed",
			message: "The media server request failed.",
		});
		expect((await repo.jellyfinProfile(originalId))?.presence).toBe("missing");
		expect((await repo.jellyfinServer(server.id))?.lastSuccessAt).toBeTruthy();
		await expect(service.preview(pairing.id)).rejects.toThrow(
			"missing, disabled",
		);
	});

	it("persists one directory schedule across restart and visits both providers", async () => {
		let clock = 10_000;
		const { service, repo, secrets, plex, jellyfin, pair } = await setup(
			() => clock,
		);
		await pair();
		await service.configureDirectoryPolling({
			enabled: true,
			intervalMinutes: 60,
		});
		const restarted = createMediaService({
			repo,
			secrets,
			plex,
			jellyfin,
			now: () => clock,
		});
		expect((await restarted.state()).directoryPolling.nextAttemptAt).toBe(
			clock + 60 * 60_000,
		);
		clock += 60 * 60_000;
		await restarted.tick();
		const state = await restarted.state();
		expect(state.directoryPolling.lastAttemptAt).toBe(clock);
		expect(state.plexServers[0]?.lastAttemptAt).toBe(clock);
		expect((await repo.jellyfinServers())[0]?.lastAttemptAt).toBe(clock);
	});
	it("refreshes Jellyfin when Plex directory fails", async () => {
		const { service, repo, state, pair } = await setup();
		await pair();
		state.failDirectory = true;
		const results = (await service.refreshDirectories()).results;
		expect(
			results.map(({ kind, result }) => [kind, result.kind]).sort(),
		).toEqual([
			["jellyfin", "updated"],
			["plex", "failed"],
		]);
		expect((await repo.jellyfinServers())[0]?.lastError).toBeNull();
	});
	for (const order of ["run first", "directory first"] as const) {
		it(`commits both scheduled directories after an overlapping watched run: ${order}`, async () => {
			const { service, repo, pair, plex, jellyfin } = await setup();
			const pairing = await pair();
			const runEntered = Promise.withResolvers<void>();
			const releaseRun = Promise.withResolvers<void>();
			const plexDirectoryEntered = Promise.withResolvers<void>();
			const jellyfinDirectoryEntered = Promise.withResolvers<void>();
			const releaseDirectories = Promise.withResolvers<void>();
			const originalItems = plex.items;
			plex.items = async (access) => {
				runEntered.resolve();
				await releaseRun.promise;
				return originalItems(access);
			};
			const originalPlexDirectory = plex.directory;
			plex.directory = async (input) => {
				plexDirectoryEntered.resolve();
				await releaseDirectories.promise;
				return (await originalPlexDirectory(input)).map((user) => ({
					...user,
					name: "Updated Plex user",
				}));
			};
			const originalJellyfinDirectory = jellyfin.directory;
			jellyfin.directory = async (input) => {
				jellyfinDirectoryEntered.resolve();
				await releaseDirectories.promise;
				const directory = await originalJellyfinDirectory(input);
				return {
					...directory,
					users: directory.users.map((user) => ({
						...user,
						name: "Updated Jellyfin user",
					})),
				};
			};
			const directoriesEntered = Promise.all([
				plexDirectoryEntered.promise,
				jellyfinDirectoryEntered.promise,
			]);
			const run = order === "run first" ? service.run(pairing.id) : undefined;
			if (run) await runEntered.promise;
			const tick = service.tick();
			await directoriesEntered;
			const activeRun = run ?? service.run(pairing.id);
			await runEntered.promise;
			releaseDirectories.resolve();
			await setImmediate();
			releaseRun.resolve();
			expect((await activeRun).status).toBe("completed");
			await tick;
			expect((await repo.plexProfile(pairing.plexProfileId))?.name).toBe(
				"Updated Plex user",
			);
			expect(
				(await repo.jellyfinProfile(pairing.jellyfinProfileId))?.name,
			).toBe("Updated Jellyfin user");
			expect((await repo.plexServers())[0]?.lastError).toBeNull();
			expect((await repo.jellyfinServers())[0]?.lastError).toBeNull();
		});
	}
	for (const operation of ["preview", "run", "automatic"] as const) {
		it(`preserves migrated Jellyfin credentials for ${operation} until the directory succeeds`, async () => {
			const { db, service, repo, secrets, pair, jellyfin, state } =
				await setup();
			const pairing = await pair();
			await db
				.update(schema.jellyfinProfiles)
				.set({
					connectionId: null,
					presence: "unverified",
					serverId: "legacy-server",
					url: "http://legacy-jellyfin",
					token: secrets.encrypt(
						pairing.jellyfinProfileId,
						new Secret("j-token"),
					),
				})
				.where(eq(schema.jellyfinProfiles.id, pairing.jellyfinProfileId));
			await repo.backfillJellyfinServers(secrets);
			jellyfin.directory = async () => {
				throw new MediaError("Directory unavailable.", 502);
			};
			const originalItems = jellyfin.items;
			jellyfin.items = async (access) => {
				expect(access.url).toBe("http://legacy-jellyfin");
				expect(access.token.reveal()).toBe("j-token");
				return originalItems(access);
			};
			const profile = await repo.jellyfinProfile(pairing.jellyfinProfileId);
			if (!profile?.connectionId) throw new Error("Missing migrated server");
			expect(
				(await service.state()).jellyfinProfiles.find(
					({ id }) => id === profile.id,
				),
			).toMatchObject({ canSync: true });
			expect(
				(await service.refreshJellyfinUsers(profile.connectionId)).kind,
			).toBe("failed");
			if (operation === "preview") {
				expect((await service.preview(pairing.id)).writes).toHaveLength(1);
			} else if (operation === "run") {
				expect((await service.run(pairing.id)).status).toBe("completed");
				expect(state.writes).toEqual(["jellyfin:j1"]);
			} else {
				await service.automatic(pairing.id, true);
				await service.tick();
				expect(state.writes).toEqual(["jellyfin:j1"]);
			}
			jellyfin.directory = async () => ({
				server: { id: "legacy-server", name: "Legacy" },
				users: [],
			});
			expect(
				(await service.refreshJellyfinUsers(profile.connectionId)).kind,
			).toBe("updated");
			expect(
				(await service.state()).jellyfinProfiles.find(
					({ id }) => id === profile.id,
				),
			).toMatchObject({ canSync: false });
			await expect(service.preview(pairing.id)).rejects.toThrow(
				"missing, disabled, or awaiting refresh",
			);
			jellyfin.directory = async () => ({
				server: { id: "legacy-server", name: "Legacy" },
				users: [
					{
						id: "j-child",
						name: "Child",
						disabled: true,
						administrator: false,
						lastActivityDate: null,
						lastLoginDate: null,
						details: {},
					},
				],
			});
			expect(
				(await service.refreshJellyfinUsers(profile.connectionId)).kind,
			).toBe("updated");
			expect(
				(await service.state()).jellyfinProfiles.find(
					({ id }) => id === profile.id,
				),
			).toMatchObject({ canSync: false });
			await expect(service.preview(pairing.id)).rejects.toThrow(
				"missing, disabled, or awaiting refresh",
			);
		});
	}
	it("backfills shared credentials without changing profile or pairing IDs", async () => {
		const { db, repo, secrets } = await setup();
		await db.insert(schema.plexAccounts).values({
			id: "account",
			userId: "owner",
			name: "Owner",
			token: "legacy",
		});
		await db.insert(schema.plexProfiles).values({
			id: "plex",
			accountId: "account",
			userId: "owner",
			name: "Owner",
			serverId: "plex-server",
			serverName: "Plex",
			url: "http://plex",
			token: "legacy",
		});
		for (const id of ["legacy-a", "legacy-b"])
			await db.insert(schema.jellyfinProfiles).values({
				id,
				userId: id,
				name: id,
				serverId: "legacy-server",
				url: "http://jellyfin",
				token: secrets.encrypt(id, new Secret("shared-key")),
			});
		await db.insert(schema.syncPairings).values({
			id: "pair",
			plexProfileId: "plex",
			jellyfinProfileId: "legacy-a",
		});
		await repo.backfillJellyfinServers(secrets);
		await repo.backfillJellyfinServers(secrets);
		const servers = await repo.jellyfinServers();
		expect(servers).toHaveLength(1);
		expect(secrets.decrypt(servers[0].id, servers[0].token).reveal()).toBe(
			"shared-key",
		);
		expect(
			(await repo.jellyfinProfiles()).map((profile) => profile.id).sort(),
		).toEqual(["legacy-a", "legacy-b"]);
		expect((await repo.pairing("pair"))?.jellyfinProfileId).toBe("legacy-a");
		expect(
			secrets
				.decrypt(
					"legacy-a",
					(await repo.jellyfinProfile("legacy-a"))?.token ?? "",
				)
				.reveal(),
		).toBe("shared-key");
	});

	it("leaves conflicting legacy credentials unchanged for explicit repair", async () => {
		const { db, repo, secrets } = await setup();
		for (const [id, key] of [
			["first", "key-one"],
			["second", "key-two"],
		])
			await db.insert(schema.jellyfinProfiles).values({
				id,
				userId: id,
				name: id,
				serverId: "legacy-server",
				url: "http://jellyfin",
				token: secrets.encrypt(id, new Secret(key)),
			});
		await expect(repo.backfillJellyfinServers(secrets)).rejects.toThrow(
			"first, second",
		);
		expect(await repo.jellyfinServers()).toEqual([]);
		expect((await repo.jellyfinProfile("first"))?.connectionId).toBeNull();
		expect(
			secrets
				.decrypt("second", (await repo.jellyfinProfile("second"))?.token ?? "")
				.reveal(),
		).toBe("key-two");
	});

	it("repair command verifies server identity before replacing conflicting keys", async () => {
		const { db, repo, secrets, databaseUrl } = await setup();
		for (const [id, key] of [
			["first", "key-one"],
			["second", "key-two"],
		])
			await db.insert(schema.jellyfinProfiles).values({
				id,
				userId: id,
				name: id,
				serverId: "legacy-server",
				url: "http://old-jellyfin",
				token: secrets.encrypt(id, new Secret(key)),
			});
		const fixture = Bun.serve({
			port: 0,
			fetch(request) {
				const path = new URL(request.url).pathname;
				if (path === "/System/Info")
					return Response.json({ Id: "legacy-server", ServerName: "Jellyfin" });
				if (path === "/Users")
					return Response.json([{ Id: "first", Name: "First" }]);
				return Response.json({}, { status: 404 });
			},
		});
		try {
			const command = Bun.spawn(
				[process.execPath, "scripts/repair-jellyfin-legacy.ts"],
				{
					cwd: process.cwd(),
					stdout: "pipe",
					stderr: "pipe",
					env: {
						...process.env,
						DATABASE_URL: databaseUrl,
						CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
						JELLYFIN_SERVER_ID: "legacy-server",
						JELLYFIN_URL: fixture.url.toString(),
						JELLYFIN_API_KEY: "repaired-key",
					},
				},
			);
			expect(await command.exited).toBe(0);
			expect(
				secrets
					.decrypt("first", (await repo.jellyfinProfile("first"))?.token ?? "")
					.reveal(),
			).toBe("repaired-key");
			expect(
				secrets
					.decrypt(
						"second",
						(await repo.jellyfinProfile("second"))?.token ?? "",
					)
					.reveal(),
			).toBe("repaired-key");
			await repo.backfillJellyfinServers(secrets);
			expect((await repo.jellyfinServers())[0]?.externalId).toBe(
				"legacy-server",
			);
		} finally {
			fixture.stop(true);
		}
	});

	it("uses the most recently signed-in Plex account after a restart", async () => {
		const { repo, secrets, plex, jellyfin, service, state } = await setup();
		const firstAttempt = await service.startLogin();
		const firstLogin = await service.pollLogin(firstAttempt.id);
		if (firstLogin.status !== "linked") throw new Error("Expected Plex login");
		expect((await service.state()).activePlexAccountId).toBe(
			firstLogin.accountId,
		);

		state.plexLogin = {
			userId: "other-owner",
			name: "Other owner",
			token: new Secret("other-owner-token"),
		};
		const secondAttempt = await service.startLogin();
		const secondLogin = await service.pollLogin(secondAttempt.id);
		if (secondLogin.status !== "linked") throw new Error("Expected Plex login");
		const restarted = createMediaService({ repo, secrets, plex, jellyfin });
		expect((await restarted.state()).activePlexAccountId).toBe(
			secondLogin.accountId,
		);
	});
	it("persists encrypted profile tokens and exposes no credentials", async () => {
		const { service, repo, pair } = await setup();
		await pair();
		expect((await repo.plexProfiles())[0]?.token?.startsWith("v1:")).toBe(true);
		expect((await repo.jellyfinServers())[0]?.token.startsWith("v1:")).toBe(
			true,
		);
		expect(JSON.stringify(await service.state())).not.toMatch(
			/owner-token|child-token|j-token|never-store|1234|v1:/,
		);
		expect(
			(await service.state()).plexProfiles.find(
				(profile) => profile.userId === "child",
			),
		).toMatchObject({ serverId: "machine", accessStatus: "available" });
	});
	it("previews without writing, merges both directions, and does nothing on a repeated run", async () => {
		const { service, state, pair } = await setup();
		const pairing = await pair();
		const preview = await service.preview(pairing.id);
		expect(preview.writes).toEqual([
			{ target: "jellyfin", itemId: "j1", title: "Arrival" },
		]);
		expect(state.writes).toEqual([]);
		expect(await service.run(pairing.id)).toMatchObject({
			status: "completed",
			applied: 1,
		});
		expect(state.jellyfin[0].watched).toBe(true);
		expect(await service.run(pairing.id)).toMatchObject({
			status: "completed",
			applied: 0,
		});
		state.plex = [movie("p1", false)];
		expect(await service.run(pairing.id)).toMatchObject({
			status: "completed",
			applied: 1,
		});
		expect(state.plex[0].watched).toBe(true);
		expect(state.writes).toEqual(["jellyfin:j1", "plex:p1"]);
	});
	it("does not write when a complete library cannot be read", async () => {
		const { service, state, pair } = await setup();
		const pairing = await pair();
		state.failRead = true;
		expect(await service.run(pairing.id)).toMatchObject({
			status: "failed",
			applied: 0,
		});
		expect(state.jellyfin[0].watched).toBe(false);
		state.failRead = false;
		expect(await service.run(pairing.id)).toMatchObject({
			status: "completed",
			applied: 1,
		});
	});
	it("records failure and reconciles fresh state on retry", async () => {
		const { service, state, pair } = await setup();
		const pairing = await pair();
		state.failWrite = true;
		expect(await service.run(pairing.id)).toMatchObject({
			status: "failed",
			applied: 0,
			planned: 1,
		});
		state.failWrite = false;
		expect(await service.run(pairing.id)).toMatchObject({
			status: "completed",
			applied: 1,
		});
		expect(
			(await service.state()).runs.map((run) => run.status).sort(),
		).toEqual(["completed", "failed"]);
	});
	it("prevents a profile from bridging two different pairings", async () => {
		const { service, pair } = await setup();
		const pairing = await pair();
		await expect(
			service.addPairing({
				plexProfileId: pairing.plexProfileId,
				jellyfinProfileId: pairing.jellyfinProfileId,
			}),
		).rejects.toThrow("only one pairing");
		expect((await service.state()).pairings).toHaveLength(1);
	});
	it("keeps pairings and decryptable tokens across service restart", async () => {
		const { repo, secrets, plex, jellyfin, pair } = await setup();
		const pairing = await pair();
		const restarted = createMediaService({ repo, secrets, plex, jellyfin });
		expect((await restarted.state()).pairings[0]?.id).toBe(pairing.id);
		expect(await restarted.run(pairing.id)).toMatchObject({
			status: "completed",
			applied: 1,
		});
	});
	it("requires explicit automatic sync opt-in", async () => {
		const { service, state, pair } = await setup();
		const pairing = await pair();
		await service.tick();
		expect(state.jellyfin[0].watched).toBe(false);
		await service.automatic(pairing.id, true);
		await service.tick();
		expect(state.jellyfin[0].watched).toBe(true);
		expect((await service.state()).runs).toHaveLength(1);
	});
});

it("protects media routes and runs an authenticated pairing through HTTP", async () => {
	const { db, service, pair } = await setup();
	const pairing = await pair();
	const admin = createAdministratorService(() => db);
	const api = createApi(admin, service);
	const origin = "http://localhost";
	const unauthenticated = await api.handle(
		new Request(`${origin}/api/v1/media/state`),
	);
	expect(unauthenticated.status).toBe(401);
	const bootstrap = await api.handle(
		new Request(`${origin}/api/v1/admin/bootstrap`, {
			method: "POST",
			headers: { origin, "content-type": "application/json" },
			body: JSON.stringify({
				username: "owner",
				password: "long-test-password",
			}),
		}),
	);
	expect(bootstrap.status).toBe(201);
	const login = await api.handle(
		new Request(`${origin}/api/v1/admin/sign-in`, {
			method: "POST",
			headers: { origin, "content-type": "application/json" },
			body: JSON.stringify({
				username: "owner",
				password: "long-test-password",
			}),
		}),
	);
	expect(login.status).toBe(200);
	const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
	const forbidden = await api.handle(
		new Request(`${origin}/api/v1/media/pairings/${pairing.id}/run`, {
			method: "POST",
			headers: { cookie, origin: "https://other.example" },
		}),
	);
	expect(forbidden.status).toBe(403);
	const preview = await api.handle(
		new Request(`${origin}/api/v1/media/pairings/${pairing.id}/preview`, {
			method: "POST",
			headers: { cookie, origin },
		}),
	);
	expect(preview.status).toBe(200);
	expect(await preview.json()).toMatchObject({
		writes: [{ target: "jellyfin", itemId: "j1", title: "Arrival" }],
	});
	const run = await api.handle(
		new Request(`${origin}/api/v1/media/pairings/${pairing.id}/run`, {
			method: "POST",
			headers: { cookie, origin },
		}),
	);
	expect(run.status).toBe(200);
	expect(await run.json()).toMatchObject({ status: "completed", applied: 1 });
	const missing = await api.handle(
		new Request(`${origin}/api/v1/media/pairings/missing/preview`, {
			method: "POST",
			headers: { cookie, origin },
		}),
	);
	expect(missing.status).toBe(404);
	expect(await missing.json()).toEqual({ error: "Pairing not found." });
});

it("rejects overlapping runs while the first inventory is in flight", async () => {
	const { service, plex, pair } = await setup();
	const pairing = await pair();
	let release = () => {};
	let entered = () => {};
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const read = plex.items;
	plex.items = async (access) => {
		entered();
		await blocked;
		return read(access);
	};
	const first = service.run(pairing.id);
	await started;
	try {
		await expect(service.run(pairing.id)).rejects.toThrow("already running");
		expect((await service.state()).running).toBe(true);
	} finally {
		release();
	}
	expect(await first).toMatchObject({ status: "completed", applied: 1 });
	expect((await service.state()).runs).toHaveLength(1);
});

it("locks a run before the first database lookup resolves", async () => {
	const { service, repo, pair } = await setup();
	const pairing = await pair();
	let release = () => {};
	let entered = () => {};
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const findPairing = repo.pairing;
	repo.pairing = async (id) => {
		entered();
		await blocked;
		return findPairing(id);
	};
	const first = service.run(pairing.id);
	await started;
	try {
		await expect(service.run(pairing.id)).rejects.toThrow("already running");
	} finally {
		release();
	}
	expect(await first).toMatchObject({ status: "completed", applied: 1 });
});

it("runs one automatic tick when two ticks await the same pairing read", async () => {
	const { service, repo, pair } = await setup();
	const pairing = await pair();
	await service.automatic(pairing.id, true);
	let release = () => {};
	let entered = () => {};
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const findPairings = repo.pairings;
	repo.pairings = async () => {
		entered();
		await blocked;
		return findPairings();
	};
	const first = service.tick();
	await started;
	await service.tick();
	release();
	await first;
	expect((await service.state()).runs).toHaveLength(1);
});

it("retains successful writes when a later write fails and retries only the remainder", async () => {
	const { service, jellyfin, state, pair } = await setup();
	const pairing = await pair();
	state.plex.push({
		...movie("p2", true),
		ids: [{ provider: "tmdb", value: "286217" }],
	});
	state.jellyfin.push({
		...movie("j2", false),
		ids: [{ provider: "tmdb", value: "286217" }],
	});
	const mark = jellyfin.markWatched;
	jellyfin.markWatched = async (access, id) => {
		if (id === "j2") throw new MediaError("Second write failed.", 502);
		await mark(access, id);
	};
	expect(await service.run(pairing.id)).toMatchObject({
		status: "failed",
		applied: 1,
		planned: 2,
	});
	expect(state.jellyfin.map((item) => item.watched)).toEqual([true, false]);
	jellyfin.markWatched = mark;
	expect(await service.run(pairing.id)).toMatchObject({
		status: "completed",
		applied: 1,
		planned: 1,
	});
	expect(state.writes).toEqual(["jellyfin:j1", "jellyfin:j2"]);
});

describe("manual library matching", () => {
	it("persists a manual choice across service restart without changing watched status", async () => {
		const { service, repo, secrets, plex, jellyfin, state, pair } =
			await setup();
		const pairing = await pair();
		state.jellyfin[0].ids = [];
		const match = {
			pairingId: pairing.id,
			plexItemId: "p1",
			jellyfinItemId: "j1",
		};
		await service.saveManualMatch(match);
		await service.saveManualMatch(match);
		expect(state.writes).toEqual([]);
		const restarted = createMediaService({ repo, secrets, plex, jellyfin });
		expect((await restarted.library(pairing.id)).matches).toEqual([match]);
		expect((await restarted.preview(pairing.id)).writes).toEqual([
			{ target: "jellyfin", itemId: "j1", title: "Arrival" },
		]);
		await restarted.run(pairing.id);
		expect(state.writes).toEqual(["jellyfin:j1"]);
	});
	it("rejects either side of an existing pair even with concurrent saves", async () => {
		const { service, repo, state, pair } = await setup();
		const pairing = await pair();
		state.plex.push(movie("p2", false));
		state.jellyfin.push(movie("j2", false));
		const first = {
			pairingId: pairing.id,
			plexItemId: "p1",
			jellyfinItemId: "j1",
		};
		const second = { ...first, jellyfinItemId: "j2" };
		const outcomes = await Promise.allSettled([
			service.saveManualMatch(first),
			service.saveManualMatch(second),
		]);
		expect(outcomes.map((result) => result.status).sort()).toEqual([
			"fulfilled",
			"rejected",
		]);
		const [saved] = await repo.manualMatches(pairing.id);
		await expect(
			service.saveManualMatch({ ...saved, plexItemId: "p2" }),
		).rejects.toThrow("already has a manual match");
		expect(
			await repo.addManualMatch({ ...saved, plexItemId: "p2" }),
		).toBeUndefined();
		expect(
			await repo.addManualMatch({
				...saved,
				jellyfinItemId: saved.jellyfinItemId === "j1" ? "j2" : "j1",
			}),
		).toBeUndefined();
		expect(state.writes).toEqual([]);
	});
	it("validates current existence and content kind before saving", async () => {
		const { service, repo, state, pair } = await setup();
		const pairing = await pair();
		state.jellyfin[0].kind = "episode";
		const match = {
			pairingId: pairing.id,
			plexItemId: "p1",
			jellyfinItemId: "j1",
		};
		await expect(service.saveManualMatch(match)).rejects.toThrow(
			"Match movies with movies",
		);
		state.jellyfin = [];
		await expect(service.saveManualMatch(match)).rejects.toThrow(
			"no longer available",
		);
		expect(await repo.manualMatches(pairing.id)).toEqual([]);
	});
});

it("removes only the specified manual pair and allows correction without watched writes", async () => {
	const { service, repo, state, pair } = await setup();
	const pairing = await pair();
	state.jellyfin.push({ ...movie("j2", false), ids: [] });
	const match = {
		pairingId: pairing.id,
		plexItemId: "p1",
		jellyfinItemId: "j1",
	};
	await service.saveManualMatch(match);
	await service.removeManualMatch({ ...match, jellyfinItemId: "j2" });
	expect(await repo.manualMatches(pairing.id)).toEqual([match]);
	await service.removeManualMatch(match);
	await service.removeManualMatch(match);
	const corrected = { ...match, jellyfinItemId: "j2" };
	await service.saveManualMatch(corrected);
	expect(await repo.manualMatches(pairing.id)).toEqual([corrected]);
	expect(state.writes).toEqual([]);
});

it("keeps identical provider item IDs independent across people", async () => {
	const { service, repo, pair } = await setup();
	const firstPairing = await pair();
	const plexProfile = await repo.plexProfile(firstPairing.plexProfileId);
	const jellyfinProfile = await repo.jellyfinProfile(
		firstPairing.jellyfinProfileId,
	);
	if (!plexProfile || !jellyfinProfile)
		throw new Error("Expected connected profiles");
	await repo.savePlexProfile({
		...plexProfile,
		id: "other-plex",
		userId: "other-plex-user",
	});
	await repo.saveJellyfinProfiles([
		{
			...jellyfinProfile,
			id: "other-jellyfin",
			userId: "other-jellyfin-user",
		},
	]);
	const secondPairing = await service.addPairing({
		plexProfileId: "other-plex",
		jellyfinProfileId: "other-jellyfin",
	});
	const first = {
		pairingId: firstPairing.id,
		plexItemId: "p1",
		jellyfinItemId: "j1",
	};
	const second = { ...first, pairingId: secondPairing.id };
	await repo.addManualMatch(first);
	await repo.addManualMatch(second);
	await service.removeManualMatch(second);
	expect(await repo.manualMatches(firstPairing.id)).toEqual([first]);
	expect(await repo.manualMatches(secondPairing.id)).toEqual([]);
});
