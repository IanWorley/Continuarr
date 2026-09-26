import { describe, expect, it } from "bun:test";
import { createAdministratorService } from "~/backend/admin/service";
import { createApi } from "~/backend/api";
import { createSecretStorage, Secret } from "~/backend/secrets/storage";
import { setupTestDatabase } from "~/db/test-database";
import {
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
async function setup() {
	const { db } = await createTestDatabase();
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
		homePin: "",
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
		switchUser: async ({ userId, pin }) => {
			state.homePin = pin ?? "";
			return { userId, name: "Child", token: new Secret("child-token") };
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
		login: async ({ url }) => ({
			url,
			userId: "j-child",
			serverId: "j-server",
			name: "Child",
			token: new Secret("j-token"),
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
	const service = createMediaService({ repo, secrets, plex, jellyfin });
	async function pair() {
		const attempt = await service.startLogin();
		const login = await service.pollLogin(attempt.id);
		if (login.status !== "linked") throw new Error("Expected linked account");
		const selection = await service.selectProfile({
			accountId: login.accountId,
			userId: "child",
			pin: "1234",
		});
		const p = await service.connectPlex({
			selectionId: selection.id,
			serverId: "machine",
			url: "http://plex:32400",
		});
		const j = await service.connectJellyfin({
			url: "http://jellyfin:8096",
			username: "child",
			password: "never-store",
		});
		return service.addPairing({ plexProfileId: p.id, jellyfinProfileId: j.id });
	}
	return { db, repo, secrets, service, state, pair, plex, jellyfin };
}

describe("media account and sync service", () => {
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
		const { service, repo, state, pair } = await setup();
		await pair();
		expect(state.homePin).toBe("1234");
		expect((await repo.plexProfiles())[0]?.token.startsWith("v1:")).toBe(true);
		expect((await repo.jellyfinProfiles())[0]?.token.startsWith("v1:")).toBe(
			true,
		);
		expect(JSON.stringify(await service.state())).not.toMatch(
			/owner-token|child-token|j-token|never-store|1234|v1:/,
		);
		expect((await service.state()).plexProfiles[0]).toMatchObject({
			userId: "child",
			serverId: "machine",
		});
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

it("reuses the encrypted row identity during concurrent reconnects", async () => {
	const { service, repo, secrets } = await setup();
	const input = {
		url: "http://jellyfin:8096",
		username: "child",
		password: "never-store",
	};
	const [first, second] = await Promise.all([
		service.connectJellyfin(input),
		service.connectJellyfin(input),
	]);
	expect(first.id).toBe(second.id);
	const [stored] = await repo.jellyfinProfiles();
	if (!stored) throw new Error("Missing Jellyfin profile");
	expect(secrets.decrypt(stored.id, stored.token).reveal()).toBe("j-token");
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
