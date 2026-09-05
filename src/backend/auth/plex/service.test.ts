import { afterAll, describe, expect, it } from "bun:test";
import { api } from "~/backend/api";
import type * as repository from "~/backend/auth/plex/repo";
import {
	credentialKey,
	encryptCredentials,
	hashSecret,
} from "~/backend/auth/plex/secrets";
import { createPlexLoginService } from "~/backend/auth/plex/service";
import * as plex from "~/backend/shared/clients/plexclient";

const TEST_KEY = "ab".repeat(32);
const ORIGINAL_KEY = process.env.CREDENTIAL_ENCRYPTION_KEY;
process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
afterAll(() => {
	if (ORIGINAL_KEY === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
	else process.env.CREDENTIAL_ENCRYPTION_KEY = ORIGINAL_KEY;
});
const ORIGIN = "https://continuarr.test";
const ACCOUNT_ALICE = 101;
const ACCOUNT_BOB = 202;

function fixture() {
	const logins = new Map<string, Parameters<typeof repository.saveLogin>[0]>();
	const users = new Map<
		number,
		Parameters<typeof repository.saveAuthenticatedUser>[0]
	>();
	const connections = new Map<
		string,
		Parameters<typeof repository.saveAuthenticatedUser>[1]
	>();
	const sessions: Parameters<typeof repository.saveAuthenticatedUser>[2][] = [];
	let accountId = ACCOUNT_ALICE;
	let authorized = true;
	let nextPin = 1;
	const repo: typeof repository = {
		saveLogin: (login) => {
			logins.set(login.state, login);
		},
		takeLogin: (state, browserHash) => {
			const login = logins.get(state);
			if (
				!login ||
				login.browserHash !== browserHash ||
				login.expiresAt <= Date.now()
			)
				return undefined;
			logins.delete(state);
			return login;
		},
		findUser: (plexId) => users.get(plexId),
		saveAuthenticatedUser: (user, connection, session) => {
			users.set(user.plexId, user);
			connections.set(user.id, connection);
			sessions.push(session);
		},
		sessionUser: () => undefined,
		deleteSession: () => {},
	};
	const client: typeof plex = {
		...plex,
		createPlexPin: async () => ({
			id: nextPin++,
			code: "pin",
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
		}),
		getPlexPin: async (id) => ({
			id,
			code: "pin",
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			authToken: authorized ? "secret-plex-token" : null,
		}),
		getPlexAccount: async () => ({
			id: accountId,
			friendlyName: accountId === ACCOUNT_ALICE ? "Alice" : "Bob",
			title: "Plex",
		}),
		registerPlexJwk: async () => ({
			authToken: "secret-plex-token",
			jwt: "secret-device-jwt",
		}),
	};
	const service = createPlexLoginService(repo, client);
	async function start(browser: string) {
		const result = await service.start(ORIGIN, browser);
		const params = new URLSearchParams(
			new URL(result.authorizationUrl).hash.slice("#!?".length),
		);
		const forwardUrl = params.get("forwardUrl");
		if (!forwardUrl) throw new Error("Missing forward URL");
		const state = new URL(forwardUrl).searchParams.get("state");
		if (!state) throw new Error("Missing callback state");
		return state;
	}
	return {
		start,
		service,
		logins,
		users,
		connections,
		sessions,
		setAccount: (id: number) => {
			accountId = id;
		},
		setAuthorized: (value: boolean) => {
			authorized = value;
		},
	};
}

describe("Plex user isolation", () => {
	it("keeps two users' credentials and sessions separate", async () => {
		const f = fixture();
		const alice = await f.service.complete(
			await f.start("alice-browser"),
			"alice-browser",
		);
		f.setAccount(ACCOUNT_BOB);
		const bob = await f.service.complete(
			await f.start("bob-browser"),
			"bob-browser",
		);
		expect(f.users.size).toBe(2);
		expect(f.connections.size).toBe(2);
		expect(f.sessions[0].userId).not.toBe(f.sessions[1].userId);
		expect(alice.status === "authenticated" && alice.user).toEqual({
			displayName: "Alice",
		});
		expect(bob.status === "authenticated" && bob.user).toEqual({
			displayName: "Bob",
		});
		for (const connection of f.connections.values()) {
			expect(connection.encryptedCredentials).not.toContain(
				"secret-plex-token",
			);
			expect(connection.encryptedCredentials).not.toContain(
				"secret-device-jwt",
			);
		}
		if (alice.status === "authenticated")
			expect(f.sessions[0].tokenHash).toBe(hashSecret(alice.sessionToken));
	});

	it("rejects another browser without consuming the owner's attempt", async () => {
		const f = fixture();
		const state = await f.start("owner");
		await expect(f.service.complete(state, "attacker")).rejects.toThrow(
			"another browser",
		);
		expect((await f.service.complete(state, "owner")).status).toBe(
			"authenticated",
		);
	});

	it("allows only one completion during concurrent requests and rejects replay", async () => {
		const f = fixture();
		const state = await f.start("owner");
		const results = await Promise.allSettled([
			f.service.complete(state, "owner"),
			f.service.complete(state, "owner"),
		]);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		await expect(f.service.complete(state, "owner")).rejects.toThrow();
		expect(f.sessions).toHaveLength(1);
	});

	it("preserves an unapproved PIN for subsequent polling", async () => {
		const f = fixture();
		f.setAuthorized(false);
		const state = await f.start("owner");
		expect(await f.service.complete(state, "owner")).toEqual({
			status: "pending",
		});
		f.setAuthorized(true);
		expect((await f.service.complete(state, "owner")).status).toBe(
			"authenticated",
		);
	});

	it("rejects expired attempts", async () => {
		const f = fixture();
		const state = await f.start("owner");
		const login = f.logins.get(state);
		if (!login) throw new Error("Missing pending login");
		login.expiresAt = Date.now() - 1;
		await expect(f.service.complete(state, "owner")).rejects.toThrow();
		expect(f.users.size).toBe(0);
	});

	it("reuses only the returning Plex user's identity", async () => {
		const f = fixture();
		await f.service.complete(await f.start("owner"), "owner");
		const id = f.users.get(ACCOUNT_ALICE)?.id;
		expect(id).toBeDefined();
		await f.service.complete(await f.start("owner"), "owner");
		expect(f.users.size).toBe(1);
		expect(f.users.get(ACCOUNT_ALICE)?.id).toBe(id);
	});
});

describe("credential encryption", () => {
	it("decrypts only with the matching user binding", async () => {
		const key = await credentialKey(TEST_KEY);
		const encrypted = JSON.parse(
			await encryptCredentials(key, "alice", "secret"),
		);
		const options = {
			name: "AES-GCM",
			iv: Buffer.from(encrypted.iv, "base64url"),
			additionalData: new TextEncoder().encode("alice"),
		};
		const ciphertext = Buffer.from(encrypted.ciphertext, "base64url");
		const plaintext = await crypto.subtle.decrypt(options, key, ciphertext);
		expect(new TextDecoder().decode(plaintext)).toBe("secret");
		await expect(
			crypto.subtle.decrypt(
				{ ...options, additionalData: new TextEncoder().encode("bob") },
				key,
				ciphertext,
			),
		).rejects.toThrow();
	});
	it("rejects missing and malformed encryption keys", async () => {
		await expect(credentialKey("")).rejects.toThrow("32-byte");
		await expect(credentialKey("invalid")).rejects.toThrow("32-byte");
	});
});

describe("login HTTP boundary", () => {
	it("rejects cross-origin login initiation", async () => {
		const response = await api.handle(
			new Request(`${ORIGIN}/api/v1/auth/plex/login/start`, {
				method: "POST",
				headers: { origin: "https://attacker.test" },
			}),
		);
		expect(response.status).toBe(403);
	});
	it("requires the initiating browser cookie", async () => {
		const response = await api.handle(
			new Request(`${ORIGIN}/api/v1/auth/plex/login/complete`, {
				method: "POST",
				headers: { origin: ORIGIN, "content-type": "application/json" },
				body: JSON.stringify({ state: crypto.randomUUID() }),
			}),
		);
		expect(response.status).toBe(401);
	});
	it("does not start authentication with GET", async () => {
		const response = await api.handle(
			new Request(`${ORIGIN}/api/v1/auth/plex/login/start`),
		);
		expect(response.status).toBe(405);
	});
});
