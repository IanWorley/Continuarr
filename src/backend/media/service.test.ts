import { describe, expect, it } from "bun:test";
import { setImmediate } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { createAdministratorService } from "~/backend/admin/service";
import { createApi } from "~/backend/api";
import { createSecretStorage, Secret } from "~/backend/secrets/storage";
import * as schema from "~/db/schema";
import { setupTestDatabase } from "~/db/test-database";
import { NO_POSITION_MS, POSITION_TOLERANCE_MS } from "./constants";
import type { ProviderIds } from "./episode";
import {
	isStale,
	type JellyfinDirectory,
	type JellyfinProvider,
	MediaError,
	type MediaItem,
	type PlexProvider,
	type WriteResult,
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
	history: { lastPlayedAt: null, positionMs: null },
});
const playedMovie = (
	id: string,
	tmdb: string,
	title: string,
	watched: boolean,
	history: MediaItem["history"],
): MediaItem => ({
	...movie(id, watched),
	title,
	ids: [{ provider: "tmdb", value: tmdb }],
	history,
});
function withPosition(
	items: MediaItem[],
	id: string,
	positionMs: number,
): MediaItem[] {
	return items.map((item) =>
		item.id === id
			? { ...item, history: { ...item.history, positionMs } }
			: item,
	);
}
/** Both servers clear the resume position when they mark an item watched; `resumeAt` writes it back. */
function markItemWatched(
	items: MediaItem[],
	id: string,
	resumeAt: number | undefined,
): MediaItem[] {
	return items.map((item) =>
		item.id === id
			? {
					...item,
					watched: true,
					history: { ...item.history, positionMs: resumeAt ?? null },
				}
			: item,
	);
}
function watchedWriteLabel(
	side: string,
	id: string,
	playedAt: number | undefined,
	resumeAt: number | undefined,
): string {
	return [
		`${side}:${id}`,
		...(playedAt === undefined ? [] : [`played ${playedAt}`]),
		...(resumeAt === undefined ? [] : [`resume ${resumeAt}`]),
	].join(" ");
}
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
	function currentPosition(side: "plex" | "jellyfin", id: string): number {
		return (
			state[side].find((item) => item.id === id)?.history.positionMs ??
			NO_POSITION_MS
		);
	}
	/** Follows the provider contract: skip a write once the destination moved since the scan. */
	function positionWriter(side: "plex" | "jellyfin") {
		return async (
			_access: unknown,
			id: string,
			positionMs: number,
			replaces: number | null,
		): Promise<WriteResult> => {
			const current = currentPosition(side, id);
			if (Math.abs(current - positionMs) <= POSITION_TOLERANCE_MS)
				return "applied";
			if (isStale(current, replaces, positionMs)) return "stale";
			state.writes.push(`${side}:${id} resume ${positionMs}`);
			state[side] = withPosition(state[side], id, positionMs);
			return "applied";
		};
	}
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
		markWatched: async (_access, id, { replaces, resumeAt }) => {
			if (isStale(currentPosition("plex", id), replaces, resumeAt))
				return "stale";
			state.writes.push(watchedWriteLabel("plex", id, undefined, resumeAt));
			state.plex = markItemWatched(state.plex, id, resumeAt);
			return "applied";
		},
		setPosition: positionWriter("plex"),
	};
	const jellyfin: JellyfinProvider = {
		authenticate: async () => {
			throw new Error("The media service never signs in to Jellyfin.");
		},
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
		markWatched: async (access, id, { replaces, playedAt, resumeAt }) => {
			expect(access.token.reveal()).toBe("j-token");
			if (state.failWrite) throw new MediaError("Write failed.", 502);
			if (isStale(currentPosition("jellyfin", id), replaces, resumeAt))
				return "stale";
			state.writes.push(watchedWriteLabel("jellyfin", id, playedAt, resumeAt));
			state.jellyfin = markItemWatched(state.jellyfin, id, resumeAt);
			return "applied";
		},
		setPosition: positionWriter("jellyfin"),
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
	for (const refresh of ["scheduled", "individual"] as const) {
		it(`preserves legacy Plex grants during ${refresh} refresh until explicit owner adoption`, async () => {
			const { service, repo, secrets, state } = await setup();
			const attempt = await service.startLogin();
			const login = await service.pollLogin(attempt.id);
			if (login.status !== "linked") throw new Error("Expected login");
			for (const userId of ["owner", "child"]) {
				const id = crypto.randomUUID();
				await repo.savePlexProfile({
					id,
					accountId: login.accountId,
					userId,
					name: userId,
					serverId: "machine",
					serverName: "Plex",
					url: "http://plex:32400",
					token: secrets.encrypt(id, new Secret(`legacy-${userId}-token`)),
				});
			}
			await repo.backfillPlexServers();
			const server = (await repo.plexServers())[0];
			if (!server) throw new Error("Missing backfilled server");
			expect(
				(await service.state()).plexServers.map(({ externalId, verified }) => ({
					externalId,
					verified,
				})),
			).toEqual([{ externalId: "machine", verified: false }]);
			const originalProfiles = await repo.plexProfiles();
			state.grant = false;
			if (refresh === "scheduled") {
				await service.tick();
				expect((await repo.directoryPolling()).lastAttemptAt).toBeGreaterThan(
					0,
				);
			} else {
				await expect(service.refreshPlexUsers(server.id)).rejects.toThrow(
					"Save this Plex server as its owner before refreshing users.",
				);
			}
			for (const original of originalProfiles) {
				expect(await repo.plexProfile(original.id)).toEqual(original);
				expect(original.connectionId).toBeNull();
				expect(
					secrets.decrypt(original.id, original.token ?? "").reveal(),
				).toBe(`legacy-${original.userId}-token`);
			}
			expect(await repo.plexServer(server.id)).toEqual(server);
		});
	}
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
		expect(
			(await service.state()).plexServers.map(({ id, verified }) => ({
				id,
				verified,
			})),
		).toEqual([{ id: candidate?.id, verified: false }]);
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
		expect(
			(await service.state()).plexServers.map((server) => server.id),
		).toEqual([candidate?.id]);
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
	it("rejects a different Plex server while one is connected", async () => {
		const { service, repo, plex, pair } = await setup();
		await pair();
		plex.servers = async () => [
			{
				id: "other-machine",
				name: "Other Plex",
				token: new Secret("other-token"),
				connections: ["http://other-plex:32400"],
			},
		];
		const selection = await service.selectPlexServer({
			accountId: (await repo.accounts())[0]?.id ?? "",
		});
		await expect(
			service.connectPlex({
				selectionId: selection.id,
				serverId: "other-machine",
				url: "http://other-plex:32400",
			}),
		).rejects.toMatchObject({
			status: 409,
			message:
				"A Plex server is already connected. Disconnect it to connect a different server.",
		});
		expect(
			(await repo.plexServers()).map(({ externalId, verified }) => ({
				externalId,
				verified,
			})),
		).toEqual([{ externalId: "machine", verified: true }]);
	});
	describe("with a Plex server saved before owner adoption", () => {
		async function setupLegacyServer() {
			const context = await setup();
			const { service, repo, secrets } = context;
			const attempt = await service.startLogin();
			const login = await service.pollLogin(attempt.id);
			if (login.status !== "linked") throw new Error("Expected login");
			const legacyId = crypto.randomUUID();
			await repo.savePlexProfile({
				id: legacyId,
				accountId: login.accountId,
				userId: "owner",
				name: "Owner",
				serverId: "legacy-machine",
				serverName: "Legacy Plex",
				url: "http://legacy-plex:32400",
				token: secrets.encrypt(legacyId, new Secret("legacy-token")),
			});
			await repo.backfillPlexServers();
			const selection = await service.selectPlexServer({
				accountId: login.accountId,
			});
			const connectMachine = () =>
				service.connectPlex({
					selectionId: selection.id,
					serverId: "machine",
					url: "http://plex:32400",
				});
			return { ...context, connectMachine };
		}
		it("rejects a different Plex server", async () => {
			const { repo, connectMachine } = await setupLegacyServer();
			await expect(connectMachine()).rejects.toMatchObject({
				status: 409,
				message:
					"A Plex server is already connected. Disconnect it to connect a different server.",
			});
			expect(
				(await repo.plexServers()).map(({ externalId }) => externalId),
			).toEqual(["legacy-machine"]);
		});
		it("lists the legacy server so the owner can disconnect it and switch", async () => {
			const { service, connectMachine } = await setupLegacyServer();
			const [legacy] = (await service.state()).plexServers;
			expect(legacy).toMatchObject({
				externalId: "legacy-machine",
				name: "Legacy Plex",
				verified: false,
			});
			await service.disconnectPlex(legacy?.id ?? "");
			await connectMachine();
			expect(
				(await service.state()).plexServers.map(({ externalId, verified }) => ({
					externalId,
					verified,
				})),
			).toEqual([{ externalId: "machine", verified: true }]);
		});
	});
	it("rejects a second Jellyfin server while one is connected", async () => {
		const { service, repo, jellyfin, pair } = await setup();
		await pair();
		const directory = jellyfin.directory;
		jellyfin.directory = async (access) => ({
			...(await directory(access)),
			server: { id: "other-jellyfin", name: "Other Jellyfin" },
		});
		await expect(
			service.importJellyfin({
				kind: "new",
				url: "http://other-jellyfin:8096",
				apiKey: "other-key",
			}),
		).rejects.toMatchObject({
			status: 409,
			message:
				"A Jellyfin server is already connected. Replace its key, or disconnect it to connect a different server.",
		});
		expect(
			(await repo.jellyfinServers()).map(({ externalId }) => externalId),
		).toEqual(["j-server"]);
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
			{
				kind: "watched",
				target: "jellyfin",
				itemId: "j1",
				title: "Arrival",
				replaces: null,
			},
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
	it("matches episodes by series ID and numbers, then plans nothing once converged", async () => {
		const { service, state, pair } = await setup();
		const pairing = await pair();
		const episode = (
			id: string,
			number: number,
			watched: boolean,
			providerIds: ProviderIds,
		): MediaItem => ({
			id,
			kind: "episode",
			title: `Episode ${number}`,
			ids: [],
			watched,
			history: { lastPlayedAt: null, positionMs: null },
			episode: {
				series: { localId: null, providerIds },
				numbering: {
					kind: "season",
					season: 1,
					episodes: { first: number, count: 1 },
				},
			},
		});
		state.plex = [
			episode("p1", 1, true, { tvdb: "81189" }),
			episode("p2", 2, false, { tvdb: "81189" }),
			episode("p3", 3, false, {}),
		];
		state.jellyfin = [
			episode("j1", 1, false, { tvdb: "81189", tmdb: "1396" }),
			episode("j2", 2, true, { tvdb: "81189", tmdb: "1396" }),
		];
		expect(await service.preview(pairing.id)).toMatchObject({
			writes: [
				{ target: "jellyfin", itemId: "j1" },
				{ target: "plex", itemId: "p2" },
			],
			matched: 2,
			unmatched: 1,
			missingSeriesIds: 1,
		});
		expect(await service.run(pairing.id)).toMatchObject({
			status: "completed",
			applied: 2,
			summary:
				"2 updates completed (2 watched, 0 positions). 2 matched pairs; 1 unmatched items; 0 ambiguous items skipped. 0 unavailable manual matches skipped. 0 unavailable show matches skipped. 0 position conflicts skipped. 0 updates skipped after newer playback. Of the skipped episodes, 1 have no series ID, 0 have no episode ID, and 0 cannot match by number.",
		});
		expect(await service.run(pairing.id)).toMatchObject({
			status: "completed",
			planned: 0,
			applied: 0,
		});
		expect(state.writes).toEqual(["jellyfin:j1", "plex:p2"]);
	});
	it("copies the later resume position in both directions and skips a conflict", async () => {
		const { service, state, pair } = await setup();
		const pairing = await pair();
		state.plex = [
			playedMovie("p1", "1", "Arrival", false, {
				lastPlayedAt: 200000,
				positionMs: 30000,
			}),
			playedMovie("p2", "2", "Heat", false, {
				lastPlayedAt: 100000,
				positionMs: null,
			}),
			playedMovie("p3", "3", "Alien", true, {
				lastPlayedAt: 300000,
				positionMs: null,
			}),
		];
		state.jellyfin = [
			playedMovie("j1", "1", "Arrival", false, {
				lastPlayedAt: 100000,
				positionMs: 10000,
			}),
			playedMovie("j2", "2", "Heat", false, {
				lastPlayedAt: 400000,
				positionMs: 50000,
			}),
			playedMovie("j3", "3", "Alien", false, {
				lastPlayedAt: 300000,
				positionMs: 20000,
			}),
		];
		const preview = await service.preview(pairing.id);
		expect(preview.writes).toEqual([
			{
				kind: "position",
				target: "jellyfin",
				itemId: "j1",
				title: "Arrival",
				value: 30000,
				replaces: 10000,
			},
			{
				kind: "position",
				target: "plex",
				itemId: "p2",
				title: "Heat",
				value: 50000,
				replaces: null,
			},
			{
				kind: "watched",
				target: "jellyfin",
				itemId: "j3",
				title: "Alien",
				replaces: 20000,
				playedAt: 300000,
			},
		]);
		expect(preview.positionConflicts).toBe(1);
		expect(state.writes).toEqual([]);
		expect(await service.run(pairing.id)).toMatchObject({
			status: "completed",
			planned: 3,
			applied: 3,
			summary:
				"3 updates completed (1 watched, 2 positions). 3 matched pairs; 0 unmatched items; 0 ambiguous items skipped. 0 unavailable manual matches skipped. 0 unavailable show matches skipped. 1 position conflicts skipped. 0 updates skipped after newer playback. Of the skipped episodes, 0 have no series ID, 0 have no episode ID, and 0 cannot match by number.",
		});
		expect(state.writes).toEqual([
			"jellyfin:j1 resume 30000",
			"plex:p2 resume 50000",
			"jellyfin:j3 played 300000",
		]);
		expect(await service.run(pairing.id)).toMatchObject({
			status: "completed",
			planned: 0,
			applied: 0,
		});
	});
	it("skips a position write after newer playback, then copies the newer position back", async () => {
		const SCANNED_POSITION_MS = 1_200_000;
		const PLANNED_POSITION_MS = 1_800_000;
		const ADVANCED_POSITION_MS = 2_400_000;
		const { service, jellyfin, state, pair } = await setup();
		const pairing = await pair();
		state.plex = [
			playedMovie("p1", "1", "Arrival", false, {
				lastPlayedAt: 200000,
				positionMs: PLANNED_POSITION_MS,
			}),
		];
		state.jellyfin = [
			playedMovie("j1", "1", "Arrival", false, {
				lastPlayedAt: 100000,
				positionMs: SCANNED_POSITION_MS,
			}),
		];
		const items = jellyfin.items;
		jellyfin.items = async (access) => {
			const scanned = await items(access);
			state.jellyfin = [
				playedMovie("j1", "1", "Arrival", false, {
					lastPlayedAt: 500000,
					positionMs: ADVANCED_POSITION_MS,
				}),
			];
			return scanned;
		};
		expect(await service.run(pairing.id)).toMatchObject({
			status: "completed",
			planned: 1,
			applied: 0,
			summary:
				"0 updates completed (0 watched, 0 positions). 1 matched pairs; 0 unmatched items; 0 ambiguous items skipped. 0 unavailable manual matches skipped. 0 unavailable show matches skipped. 0 position conflicts skipped. 1 updates skipped after newer playback. Of the skipped episodes, 0 have no series ID, 0 have no episode ID, and 0 cannot match by number.",
		});
		expect(state.jellyfin[0].history).toEqual({
			lastPlayedAt: 500000,
			positionMs: ADVANCED_POSITION_MS,
		});
		jellyfin.items = items;
		expect(await service.run(pairing.id)).toMatchObject({
			status: "completed",
			planned: 1,
			applied: 1,
		});
		expect(state.writes).toEqual([`plex:p1 resume ${ADVANCED_POSITION_MS}`]);
	});
	it("marks watched and restores the later position in one write", async () => {
		const { service, state, pair } = await setup();
		const pairing = await pair();
		state.plex = [
			playedMovie("p1", "1", "Arrival", true, {
				lastPlayedAt: 200000,
				positionMs: 30000,
			}),
		];
		state.jellyfin = [
			playedMovie("j1", "1", "Arrival", false, {
				lastPlayedAt: 100000,
				positionMs: 10000,
			}),
		];
		expect(await service.run(pairing.id)).toMatchObject({
			status: "completed",
			planned: 1,
			applied: 1,
		});
		expect(state.writes).toEqual(["jellyfin:j1 played 200000 resume 30000"]);
		expect(state.jellyfin[0]).toMatchObject({
			watched: true,
			history: { positionMs: 30000 },
		});
		expect(await service.run(pairing.id)).toMatchObject({ planned: 0 });
	});
	it("keeps the newer position on the item it marks watched", async () => {
		const { service, state, pair } = await setup();
		const pairing = await pair();
		state.plex = [
			playedMovie("p1", "1", "Arrival", true, {
				lastPlayedAt: 100000,
				positionMs: null,
			}),
		];
		state.jellyfin = [
			playedMovie("j1", "1", "Arrival", false, {
				lastPlayedAt: 400000,
				positionMs: 50000,
			}),
		];
		expect(await service.run(pairing.id)).toMatchObject({
			status: "completed",
			planned: 2,
			applied: 2,
		});
		expect(state.writes).toEqual([
			"plex:p1 resume 50000",
			"jellyfin:j1 resume 50000",
		]);
		expect(state.jellyfin[0]).toMatchObject({
			watched: true,
			history: { positionMs: 50000 },
		});
		expect(await service.run(pairing.id)).toMatchObject({ planned: 0 });
	});
	it("skips marking watched after newer playback on that item, then keeps the newer position", async () => {
		const SCANNED_POSITION_MS = 10000;
		const ADVANCED_POSITION_MS = 40000;
		const { service, jellyfin, state, pair } = await setup();
		const pairing = await pair();
		state.plex = [
			playedMovie("p1", "1", "Arrival", true, {
				lastPlayedAt: 200000,
				positionMs: 30000,
			}),
		];
		state.jellyfin = [
			playedMovie("j1", "1", "Arrival", false, {
				lastPlayedAt: 100000,
				positionMs: SCANNED_POSITION_MS,
			}),
		];
		const items = jellyfin.items;
		jellyfin.items = async (access) => {
			const scanned = await items(access);
			state.jellyfin = [
				playedMovie("j1", "1", "Arrival", false, {
					lastPlayedAt: 500000,
					positionMs: ADVANCED_POSITION_MS,
				}),
			];
			return scanned;
		};
		expect(await service.run(pairing.id)).toMatchObject({
			status: "completed",
			planned: 1,
			applied: 0,
			summary:
				"0 updates completed (0 watched, 0 positions). 1 matched pairs; 0 unmatched items; 0 ambiguous items skipped. 0 unavailable manual matches skipped. 0 unavailable show matches skipped. 0 position conflicts skipped. 1 updates skipped after newer playback. Of the skipped episodes, 0 have no series ID, 0 have no episode ID, and 0 cannot match by number.",
		});
		expect(state.jellyfin[0]).toMatchObject({
			watched: false,
			history: { positionMs: ADVANCED_POSITION_MS },
		});
		jellyfin.items = items;
		expect(await service.run(pairing.id)).toMatchObject({
			status: "completed",
			planned: 2,
			applied: 2,
		});
		expect(state.writes).toEqual([
			`plex:p1 resume ${ADVANCED_POSITION_MS}`,
			`jellyfin:j1 resume ${ADVANCED_POSITION_MS}`,
		]);
		expect(state.jellyfin[0]).toMatchObject({
			watched: true,
			history: { positionMs: ADVANCED_POSITION_MS },
		});
	});
	it("retries a failed mark-watched write with its position after the copy succeeded", async () => {
		const { service, state, pair } = await setup();
		const pairing = await pair();
		state.plex = [
			playedMovie("p1", "1", "Arrival", true, {
				lastPlayedAt: 100000,
				positionMs: null,
			}),
		];
		state.jellyfin = [
			playedMovie("j1", "1", "Arrival", false, {
				lastPlayedAt: 400000,
				positionMs: 50000,
			}),
		];
		state.failWrite = true;
		expect(await service.run(pairing.id)).toMatchObject({
			status: "failed",
			planned: 2,
			applied: 1,
			summary:
				"1 of 2 updates completed. Write failed. A retry reads both libraries again first.",
		});
		state.failWrite = false;
		expect(await service.run(pairing.id)).toMatchObject({
			status: "completed",
			planned: 1,
			applied: 1,
		});
		expect(state.writes).toEqual([
			"plex:p1 resume 50000",
			"jellyfin:j1 resume 50000",
		]);
		expect(state.plex[0].history.positionMs).toBe(50000);
		expect(state.jellyfin[0]).toMatchObject({
			watched: true,
			history: { positionMs: 50000 },
		});
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
		writes: [
			{
				kind: "watched",
				target: "jellyfin",
				itemId: "j1",
				title: "Arrival",
				replaces: null,
			},
		],
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
	jellyfin.markWatched = async (access, id, options) => {
		if (id === "j2") throw new MediaError("Second write failed.", 502);
		return mark(access, id, options);
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
			{
				kind: "watched",
				target: "jellyfin",
				itemId: "j1",
				title: "Arrival",
				replaces: null,
			},
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
		state.jellyfin = [
			{
				...movie("j1", false),
				kind: "episode",
				episode: {
					series: { localId: null, providerIds: {} },
					numbering: { kind: "unnumbered" },
				},
			},
		];
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

describe("safe server disconnect", () => {
	for (const provider of ["plex", "jellyfin"] as const) {
		it(`disconnects ${provider} credentials atomically and reconnects retained identities without resuming automatic sync`, async () => {
			const { db, service, repo, secrets, plex, jellyfin, pair, state } =
				await setup();
			const pairing = await pair();
			await service.saveManualMatch({
				pairingId: pairing.id,
				plexItemId: "p1",
				jellyfinItemId: "j1",
			});
			await service.run(pairing.id);
			await service.automatic(pairing.id, true);
			const runs = await repo.runs();
			const matches = await repo.manualMatches(pairing.id);
			const accounts = await repo.accounts();
			const server =
				provider === "plex"
					? (await repo.plexServers())[0]
					: (await repo.jellyfinServers())[0];
			if (!server) throw new Error("Missing saved server");
			const legacyId = crypto.randomUUID();
			const linkedId = crypto.randomUUID();
			if (provider === "plex") {
				const account = accounts[0];
				if (!account) throw new Error("Missing Plex account");
				for (const [id, serverId, connectionId] of [
					[legacyId, server.externalId, null],
					[linkedId, "old-machine-id", server.id],
				] as const)
					await repo.savePlexProfile({
						id,
						accountId: account.id,
						userId: id,
						name: "Legacy",
						serverId,
						serverName: server.name,
						url: server.url,
						connectionId,
						token: secrets.encrypt(id, new Secret("legacy-grant")),
					});
			} else {
				for (const [id, serverId, connectionId] of [
					[legacyId, server.externalId, null],
					[linkedId, "old-machine-id", server.id],
				] as const)
					await db.insert(schema.jellyfinProfiles).values({
						id,
						userId: id,
						name: "Legacy",
						serverId,
						url: server.url,
						connectionId,
						token: secrets.encrypt(id, new Secret("legacy-key")),
					});
			}
			const disconnect =
				provider === "plex"
					? service.disconnectPlex
					: service.disconnectJellyfin;
			expect(await disconnect(server.id)).toEqual({ id: server.id });
			expect(await disconnect(server.id)).toEqual({ id: server.id });
			const profiles =
				provider === "plex"
					? await repo.plexProfiles()
					: await repo.jellyfinProfiles();
			for (const id of [
				provider === "plex" ? pairing.plexProfileId : pairing.jellyfinProfileId,
				legacyId,
				linkedId,
			]) {
				const profile = profiles.find((profile) => profile.id === id);
				expect(profile).toMatchObject({
					id,
					connectionId: null,
					token: null,
					presence: "missing",
				});
				if (provider === "plex")
					expect(profile).toMatchObject({ accessStatus: "unavailable" });
			}
			expect(await repo.pairing(pairing.id)).toMatchObject({
				id: pairing.id,
				plexProfileId: pairing.plexProfileId,
				jellyfinProfileId: pairing.jellyfinProfileId,
				automatic: false,
			});
			expect(await repo.runs()).toEqual(runs);
			expect(await repo.manualMatches(pairing.id)).toEqual(matches);
			expect(await repo.accounts()).toEqual(accounts);
			await expect(service.automatic(pairing.id, true)).rejects.toThrow(
				provider === "plex" ? "no server grant" : "missing, disabled",
			);
			expect(await repo.pairing(pairing.id)).toMatchObject({
				automatic: false,
			});
			await repo.backfillPlexServers();
			await repo.backfillJellyfinServers(secrets);
			const restarted = createMediaService({ repo, secrets, plex, jellyfin });
			expect(
				provider === "plex"
					? (await restarted.state()).plexServers
					: (await restarted.jellyfinDirectory()).servers,
			).toEqual([]);
			await expect(restarted.preview(pairing.id)).rejects.toThrow(
				provider === "plex" ? "no server grant" : "missing, disabled",
			);
			const writes = [...state.writes];
			await restarted.tick();
			expect(state.writes).toEqual(writes);
			expect(await repo.runs()).toEqual(runs);
			expect(await restarted.run(pairing.id)).toMatchObject({
				status: "failed",
				applied: 0,
			});
			expect(state.writes).toEqual(writes);
			if (provider === "plex") {
				const selection = await restarted.selectPlexServer({
					accountId: accounts[0]?.id ?? "",
				});
				await restarted.connectPlex({
					selectionId: selection.id,
					serverId: server.externalId,
					url: server.url,
				});
				expect(await repo.plexProfile(pairing.plexProfileId)).toMatchObject({
					id: pairing.plexProfileId,
					presence: "present",
					accessStatus: "available",
				});
				expect(
					(await repo.plexProfile(pairing.plexProfileId))?.token?.startsWith(
						"v1:",
					),
				).toBe(true);
			} else {
				await restarted.importJellyfin({
					kind: "new",
					url: server.url,
					apiKey: "j-token",
				});
				expect(
					await repo.jellyfinProfile(pairing.jellyfinProfileId),
				).toMatchObject({ id: pairing.jellyfinProfileId, presence: "present" });
			}
			expect(await repo.pairing(pairing.id)).toMatchObject({
				id: pairing.id,
				automatic: false,
			});
			expect(await repo.manualMatches(pairing.id)).toEqual(matches);
			expect(
				(provider === "plex"
					? await repo.plexProfiles()
					: await repo.jellyfinProfiles()
				).find((profile) => profile.id === legacyId),
			).toMatchObject({ token: null, presence: "missing" });
			expect(await restarted.preview(pairing.id)).toMatchObject({
				matched: 1,
				writes: [],
			});
			expect(JSON.stringify(await restarted.state())).not.toMatch(
				/owner-token|child-token|j-token|legacy-grant|legacy-key|v1:/,
			);
		});

		it(`leaves a second ${provider} server saved by an earlier version unchanged`, async () => {
			const { db, service, repo, secrets, jellyfin, pair } = await setup();
			await pair();
			const first =
				provider === "plex"
					? (await repo.plexServers())[0]
					: (await repo.jellyfinServers())[0];
			if (!first) throw new Error("Missing first server");
			// The service now refuses a second server, so save it the way earlier versions did.
			if (provider === "plex") {
				const account = (await repo.accounts())[0];
				if (!account) throw new Error("Missing Plex account");
				await repo.connectPlexServer({
					accountId: account.id,
					expectedToken: account.token,
					expectedRevision: null,
					serverId: "other-machine",
					name: "Other Plex",
					url: "http://other-plex:32400",
					users: [{ id: "owner", name: "Owner", access: { kind: "owner" } }],
					secrets,
					now: Date.now(),
				});
			} else {
				const id = crypto.randomUUID();
				const { users } = await jellyfin.directory({
					url: "http://other-jellyfin:8096",
					token: new Secret("other-key"),
				});
				await repo.addJellyfinServer(
					{
						id,
						externalId: "other-jellyfin",
						name: "Other Jellyfin",
						url: "http://other-jellyfin:8096",
						token: secrets.encrypt(id, new Secret("other-key")),
					},
					users,
					Date.now(),
				);
			}
			const other = (
				provider === "plex"
					? await repo.plexServers()
					: await repo.jellyfinServers()
			).find((server) => server.id !== first.id);
			if (!other) throw new Error("Missing other server");
			const otherProfiles = (
				provider === "plex"
					? await repo.plexProfiles()
					: await repo.jellyfinProfiles()
			).filter((profile) => profile.connectionId === other.id);
			const otherProfile = otherProfiles[0];
			if (!otherProfile) throw new Error("Missing other profile");
			const oppositeId = crypto.randomUUID();
			if (provider === "plex")
				await db.insert(schema.jellyfinProfiles).values({
					id: oppositeId,
					userId: oppositeId,
					serverId: "unrelated",
					name: "Unrelated",
				});
			else
				await repo.savePlexProfile({
					id: oppositeId,
					accountId: (await repo.accounts())[0]?.id ?? "",
					userId: oppositeId,
					serverId: "unrelated",
					serverName: "Unrelated",
					name: "Unrelated",
					url: "http://unrelated:32400",
				});
			const otherPairingId = crypto.randomUUID();
			await db.insert(schema.syncPairings).values({
				id: otherPairingId,
				plexProfileId: provider === "plex" ? otherProfile.id : oppositeId,
				jellyfinProfileId:
					provider === "jellyfin" ? otherProfile.id : oppositeId,
				automatic: true,
			});
			const accounts = await repo.accounts();
			await (provider === "plex"
				? service.disconnectPlex
				: service.disconnectJellyfin)(first.id);
			expect(
				provider === "plex"
					? await repo.plexServer(other.id)
					: await repo.jellyfinServer(other.id),
			).toEqual(other);
			expect(
				(provider === "plex"
					? await repo.plexProfiles()
					: await repo.jellyfinProfiles()
				).filter((profile) => profile.connectionId === other.id),
			).toEqual(otherProfiles);
			expect(await repo.pairing(otherPairingId)).toMatchObject({
				id: otherPairingId,
				automatic: true,
			});
			expect(await repo.accounts()).toEqual(accounts);
		});

		for (const outcome of ["success", "failure"] as const) {
			it(`supersedes an in-flight ${provider} refresh ${outcome} after disconnect`, async () => {
				const { service, repo, plex, jellyfin, pair } = await setup();
				const pairing = await pair();
				const server =
					provider === "plex"
						? (await repo.plexServers())[0]
						: (await repo.jellyfinServers())[0];
				if (!server) throw new Error("Missing server");
				const gate = Promise.withResolvers<void>();
				const entered = Promise.withResolvers<void>();
				if (provider === "plex") {
					const directory = plex.directory;
					plex.directory = async (input) => {
						entered.resolve();
						await gate.promise;
						if (outcome === "failure")
							throw new MediaError("Directory failed.", 502);
						return directory(input);
					};
				} else {
					const directory = jellyfin.directory;
					jellyfin.directory = async (input) => {
						entered.resolve();
						await gate.promise;
						if (outcome === "failure")
							throw new MediaError("Directory failed.", 502);
						return directory(input);
					};
				}
				const pending =
					provider === "plex"
						? service.refreshPlexUsers(server.id)
						: service.refreshJellyfinUsers(server.id);
				await entered.promise;
				try {
					await (provider === "plex"
						? service.disconnectPlex
						: service.disconnectJellyfin)(server.id);
				} finally {
					gate.resolve();
				}
				expect(await pending).toMatchObject({ kind: "superseded" });
				expect(
					provider === "plex"
						? await repo.plexProfile(pairing.plexProfileId)
						: await repo.jellyfinProfile(pairing.jellyfinProfileId),
				).toMatchObject({
					connectionId: null,
					token: null,
					presence: "missing",
				});
				expect(
					provider === "plex"
						? await repo.plexServers()
						: await repo.jellyfinServers(),
				).toEqual([]);
			});
		}

		it(`rejects ${provider} disconnect with 409 throughout an active watched run`, async () => {
			const { service, repo, plex, pair } = await setup();
			const pairing = await pair();
			await service.automatic(pairing.id, true);
			const server =
				provider === "plex"
					? (await repo.plexServers())[0]
					: (await repo.jellyfinServers())[0];
			if (!server) throw new Error("Missing server");
			const profiles =
				provider === "plex"
					? await repo.plexProfiles()
					: await repo.jellyfinProfiles();
			const gate = Promise.withResolvers<void>();
			const entered = Promise.withResolvers<void>();
			const read = plex.items;
			plex.items = async (access) => {
				entered.resolve();
				await gate.promise;
				return read(access);
			};
			const pending = service.run(pairing.id);
			await entered.promise;
			try {
				await expect(
					(provider === "plex"
						? service.disconnectPlex
						: service.disconnectJellyfin)(server.id),
				).rejects.toMatchObject({ status: 409 });
				expect(
					provider === "plex"
						? await repo.plexServer(server.id)
						: await repo.jellyfinServer(server.id),
				).toEqual(server);
				expect(
					provider === "plex"
						? await repo.plexProfiles()
						: await repo.jellyfinProfiles(),
				).toEqual(profiles);
				expect(await repo.pairing(pairing.id)).toMatchObject({
					automatic: true,
				});
			} finally {
				gate.resolve();
			}
			expect(await pending).toMatchObject({ status: "completed", applied: 1 });
			expect(
				await (provider === "plex"
					? service.disconnectPlex
					: service.disconnectJellyfin)(server.id),
			).toEqual({ id: server.id });
		});
	}

	it("expires ready selections and rejects a Plex connect already fetching users", async () => {
		const { service, repo, plex, pair } = await setup();
		await pair();
		const server = (await repo.plexServers())[0];
		if (!server) throw new Error("Missing server");
		const ready = await service.selectPlexServer({
			accountId: server.accountId,
		});
		const gate = Promise.withResolvers<void>();
		const entered = Promise.withResolvers<void>();
		const directory = plex.directory;
		plex.directory = async (input) => {
			entered.resolve();
			await gate.promise;
			return directory(input);
		};
		const pending = service.connectPlex({
			selectionId: ready.id,
			serverId: "machine",
			url: server.url,
		});
		await entered.promise;
		try {
			await service.disconnectPlex(server.id);
		} finally {
			gate.resolve();
		}
		await expect(pending).rejects.toThrow("Server selection expired");
		await expect(
			service.connectPlex({
				selectionId: ready.id,
				serverId: "machine",
				url: server.url,
			}),
		).rejects.toThrow("Server selection expired");
		expect(
			(await repo.plexProfiles()).map((profile) => [
				profile.connectionId,
				profile.token,
				profile.presence,
			]),
		).toEqual([
			[null, null, "missing"],
			[null, null, "missing"],
		]);
		expect(await repo.plexServers()).toEqual([]);
	});

	it("rejects discovery spanning a Plex disconnect and permits newly started discovery", async () => {
		const { service, repo, plex, pair } = await setup();
		await pair();
		const server = (await repo.plexServers())[0];
		if (!server) throw new Error("Missing server");
		const gate = Promise.withResolvers<void>();
		const entered = Promise.withResolvers<void>();
		const servers = plex.servers;
		plex.servers = async (token) => {
			entered.resolve();
			await gate.promise;
			return servers(token);
		};
		const pending = service.selectPlexServer({ accountId: server.accountId });
		await entered.promise;
		try {
			await service.disconnectPlex(server.id);
		} finally {
			gate.resolve();
		}
		await expect(pending).rejects.toThrow("Find your servers again");
		const selection = await service.selectPlexServer({
			accountId: server.accountId,
		});
		await service.connectPlex({
			selectionId: selection.id,
			serverId: "machine",
			url: server.url,
		});
		expect((await service.state()).plexServers).toMatchObject([
			{ externalId: "machine", name: "Plex" },
		]);
	});

	it("rejects a stale Jellyfin replacement after its server is disconnected", async () => {
		const { service, repo, jellyfin, pair } = await setup();
		const pairing = await pair();
		const server = (await repo.jellyfinServers())[0];
		if (!server) throw new Error("Missing server");
		const gate = Promise.withResolvers<void>();
		const entered = Promise.withResolvers<void>();
		const directory = jellyfin.directory;
		jellyfin.directory = async (input) => {
			entered.resolve();
			await gate.promise;
			return directory(input);
		};
		const pending = service.importJellyfin({
			kind: "replace",
			id: server.id,
			revision: server.revision,
			url: server.url,
			apiKey: "new-key",
		});
		await entered.promise;
		try {
			await service.disconnectJellyfin(server.id);
		} finally {
			gate.resolve();
		}
		await expect(pending).rejects.toThrow("server not found");
		expect(await repo.jellyfinProfile(pairing.jellyfinProfileId)).toMatchObject(
			{ connectionId: null, token: null, presence: "missing" },
		);
		expect(await repo.jellyfinServers()).toEqual([]);
	});

	it("rejects a new Jellyfin import spanning a disconnect and permits a newly started import", async () => {
		const { service, repo, jellyfin, pair } = await setup();
		const pairing = await pair();
		const server = (await repo.jellyfinServers())[0];
		if (!server) throw new Error("Missing server");
		const gate = Promise.withResolvers<void>();
		const entered = Promise.withResolvers<void>();
		const directory = jellyfin.directory;
		jellyfin.directory = async (input) => {
			entered.resolve();
			await gate.promise;
			return directory(input);
		};
		const pending = service.importJellyfin({
			kind: "new",
			url: server.url,
			apiKey: "stale-key",
		});
		await entered.promise;
		try {
			await service.disconnectJellyfin(server.id);
		} finally {
			gate.resolve();
		}
		await expect(pending).rejects.toThrow("Connect the server again");
		expect(await repo.jellyfinServers()).toEqual([]);
		jellyfin.directory = directory;
		await service.importJellyfin({
			kind: "new",
			url: server.url,
			apiKey: "j-token",
		});
		expect(await repo.jellyfinProfile(pairing.jellyfinProfileId)).toMatchObject(
			{ presence: "present" },
		);
	});

	it("does not let an automatic sync opt-in racing a disconnect re-enable the pairing", async () => {
		const { service, repo, pair } = await setup();
		const pairing = await pair();
		const server = (await repo.jellyfinServers())[0];
		if (!server) throw new Error("Missing server");
		const disconnect = service.disconnectJellyfin(server.id);
		const enable = service.automatic(pairing.id, true);
		await disconnect;
		await expect(enable).rejects.toThrow("missing, disabled");
		expect(await repo.pairing(pairing.id)).toMatchObject({ automatic: false });
	});
});

it("protects both disconnect routes, validates IDs, and returns credential-free idempotent responses", async () => {
	const { db, service, repo, pair } = await setup();
	await pair();
	const api = createApi(
		createAdministratorService(() => db),
		service,
	);
	const origin = "http://localhost";
	const credentials = { username: "owner", password: "long-test-password" };
	await api.handle(
		new Request(`${origin}/api/v1/admin/bootstrap`, {
			method: "POST",
			headers: { origin, "content-type": "application/json" },
			body: JSON.stringify(credentials),
		}),
	);
	const login = await api.handle(
		new Request(`${origin}/api/v1/admin/sign-in`, {
			method: "POST",
			headers: { origin, "content-type": "application/json" },
			body: JSON.stringify(credentials),
		}),
	);
	expect(login.status).toBe(200);
	const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
	for (const provider of ["plex", "jellyfin"] as const) {
		const server =
			provider === "plex"
				? (await repo.plexServers())[0]
				: (await repo.jellyfinServers())[0];
		if (!server) throw new Error("Missing saved server");
		const url = `${origin}/api/v1/media/${provider}/${server.id}`;
		for (const [headers, expectedStatus] of [
			[{ origin }, 401],
			[{ cookie }, 403],
			[{ cookie, origin: "https://foreign.example" }, 403],
		] as const) {
			const response = await api.handle(
				new Request(url, { method: "DELETE", headers }),
			);
			expect(response.status).toBe(expectedStatus);
			expect(await response.json()).toEqual({
				error:
					expectedStatus === 401
						? "Sign in to Continuarr."
						: "A same-origin request is required.",
			});
			expect(
				provider === "plex"
					? await repo.plexServer(server.id)
					: await repo.jellyfinServer(server.id),
			).toEqual(server);
		}
		const invalid = await api.handle(
			new Request(`${origin}/api/v1/media/${provider}/${"x".repeat(201)}`, {
				method: "DELETE",
				headers: { cookie, origin },
			}),
		);
		expect(invalid.status).toBe(400);
		expect(await invalid.json()).toEqual({
			error: "Check the submitted fields.",
		});
		for (const _attempt of ["first", "repeated"]) {
			const response = await api.handle(
				new Request(url, { method: "DELETE", headers: { cookie, origin } }),
			);
			expect(response.status).toBe(200);
			const body = await response.text();
			expect(JSON.parse(body)).toEqual({ id: server.id });
			expect(body).not.toMatch(/owner-token|child-token|j-token|v1:/);
		}
	}
});

it("does not expose internal disconnect failure details through HTTP", async () => {
	const { db, service, repo, pair } = await setup();
	await pair();
	const administrator = createAdministratorService(() => db);
	await administrator.bootstrap("owner", "long-test-password");
	const api = createApi(administrator, service);
	const origin = "http://localhost";
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
	const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
	const server = (await repo.plexServers())[0];
	if (!server) throw new Error("Missing saved server");
	repo.disconnectPlexServer = async () => {
		throw new Error(
			"owner-token child-token-server j-token v1:encrypted-credential",
		);
	};
	const response = await api.handle(
		new Request(`${origin}/api/v1/media/plex/${server.id}`, {
			method: "DELETE",
			headers: { cookie, origin },
		}),
	);
	expect(response.status).toBe(502);
	expect(await response.json()).toEqual({
		error:
			"Unable to contact the media service. Check the connection and try again.",
	});
	expect(await repo.plexServer(server.id)).toEqual(server);
});

function showEpisode(id: string, localId: string, watched = false): MediaItem {
	return {
		id,
		kind: "episode",
		title: id,
		ids: [],
		watched,
		history: { lastPlayedAt: null, positionMs: null },
		episode: {
			series: { localId, providerIds: {} },
			numbering: {
				kind: "season",
				season: 1,
				episodes: { first: 1, count: 1 },
			},
		},
	};
}

describe("saved show matches", () => {
	async function setupShows() {
		const context = await setup();
		const pairing = await context.pair();
		context.state.plex = [
			showEpisode("p1", "p-show", true),
			showEpisode("p2", "p-other"),
		];
		context.state.jellyfin = [
			showEpisode("j1", "j-show"),
			showEpisode("j2", "j-other"),
		];
		return {
			...context,
			match: {
				pairingId: pairing.id,
				plexShowId: "p-show",
				jellyfinShowId: "j-show",
			},
		};
	}

	it("accepts identical retries without duplicating a show match", async () => {
		const { service, repo, match } = await setupShows();
		expect(await service.saveShowMatch(match)).toEqual(match);
		expect(await service.saveShowMatch(match)).toEqual(match);
		expect(await repo.showMatches(match.pairingId)).toEqual([match]);
	});

	it("returns 409 when either show already has a counterpart", async () => {
		const { service, repo, match } = await setupShows();
		await service.saveShowMatch(match);
		for (const taken of [
			{ ...match, jellyfinShowId: "j-other" },
			{ ...match, plexShowId: "p-other" },
		]) {
			await expect(service.saveShowMatch(taken)).rejects.toMatchObject({
				status: 409,
			});
			expect(await repo.addShowMatch(taken)).toBeUndefined();
		}
		expect(await repo.showMatches(match.pairingId)).toEqual([match]);
	});

	it("keeps show counterparts independent between person pairings", async () => {
		const { service, repo, match, db, secrets } = await setupShows();
		await service.saveShowMatch(match);
		const secondPairingId = "second-show-pairing";
		const original = await repo.pairing(match.pairingId);
		if (!original) throw new Error("Missing original pairing");
		const p = await repo.plexProfile(original.plexProfileId);
		const j = await repo.jellyfinProfile(original.jellyfinProfileId);
		if (!p?.token || !j) throw new Error("Missing original profiles");
		const plexProfileId = "second-plex-profile";
		const jellyfinProfileId = "second-jellyfin-profile";
		await db.insert(schema.plexProfiles).values({
			...p,
			id: plexProfileId,
			userId: "second-plex-user",
			token: secrets.encrypt(plexProfileId, secrets.decrypt(p.id, p.token)),
		});
		await db
			.insert(schema.jellyfinProfiles)
			.values({ ...j, id: jellyfinProfileId, userId: "second-jellyfin-user" });
		await db
			.insert(schema.syncPairings)
			.values({ id: secondPairingId, plexProfileId, jellyfinProfileId });
		const second = {
			...match,
			pairingId: secondPairingId,
			jellyfinShowId: "j-other",
		};
		expect(await repo.addShowMatch(second)).toEqual(second);
		expect(await repo.showMatches(match.pairingId)).toEqual([match]);
		expect(await service.showMatches(secondPairingId)).toEqual([second]);
	});

	it("rejects a missing show with 404 and saves nothing", async () => {
		const { service, repo, match, state } = await setupShows();
		for (const missing of [
			{ ...match, plexShowId: "missing" },
			{ ...match, jellyfinShowId: "missing" },
		]) {
			await expect(service.saveShowMatch(missing)).rejects.toMatchObject({
				status: 404,
			});
		}
		expect(await repo.showMatches(match.pairingId)).toEqual([]);
		expect(state.writes).toEqual([]);
	});

	it("previews saved show episodes without changing watched state", async () => {
		const { service, state, match } = await setupShows();
		await service.saveShowMatch(match);
		expect(await service.preview(match.pairingId)).toMatchObject({
			matched: 1,
			pairs: [{ plexItemId: "p1", jellyfinItemId: "j1", source: "showMatch" }],
			writes: [
				{
					kind: "watched",
					target: "jellyfin",
					itemId: "j1",
					title: "j1",
					replaces: null,
				},
			],
		});
		expect(await service.library(match.pairingId)).toMatchObject({
			matches: [],
			showMatches: [match],
			pairs: [{ plexItemId: "p1", jellyfinItemId: "j1", source: "showMatch" }],
		});
		expect(state.writes).toEqual([]);
	});

	it("returns episodes to unmatched on removal without watched writes", async () => {
		const { service, state, match } = await setupShows();
		await service.saveShowMatch(match);
		await service.removeShowMatch(match);
		expect(await service.preview(match.pairingId)).toMatchObject({
			matched: 0,
			unmatched: 4,
			pairs: [],
			writes: [],
		});
		expect(await service.showMatches(match.pairingId)).toEqual([]);
		expect(state.writes).toEqual([]);
		expect(state.plex[0].watched).toBe(true);
		expect(state.jellyfin[0].watched).toBe(false);
	});
});
