import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { guardRequest } from "~/backend/admin/guard";
import {
	createAdministratorService,
	SESSION_DURATION_SECONDS,
	sessionCookie,
} from "~/backend/admin/service";
import { createApi } from "~/backend/api";
import * as schema from "~/db/schema";

const ORIGIN = "http://localhost";
const CREDENTIALS = { username: "owner", password: "a-long-test-password" };
const INITIAL_TIME = 1_800_000_000;
let client: InstanceType<typeof Database>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let service: ReturnType<typeof createAdministratorService>;
let api: ReturnType<typeof createApi>;
let now: number;

beforeEach(() => {
	client = new Database(":memory:");
	client.exec("PRAGMA foreign_keys = ON");
	db = drizzle({ client, schema });
	migrate(db, { migrationsFolder: "drizzle" });
	now = INITIAL_TIME;
	service = createAdministratorService(
		() => db,
		() => now,
	);
	api = createApi(service);
});
afterEach(() => client.close());

function request(
	path: string,
	method = "GET",
	body?: unknown,
	cookie?: string,
	origin = ORIGIN,
) {
	return api.handle(
		new Request(`${ORIGIN}/api/v1${path}`, {
			method,
			headers: {
				origin,
				...(body ? { "content-type": "application/json" } : {}),
				...(cookie ? { cookie } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
		}),
	);
}

async function signIn() {
	await request("/admin/bootstrap", "POST", CREDENTIALS);
	const response = await request("/admin/sign-in", "POST", CREDENTIALS);
	expect(response.status).toBe(200);
	return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

describe("installation administrator", () => {
	it("bootstraps exactly one owner, even with concurrent requests", async () => {
		expect(await (await request("/admin/setup")).json()).toEqual({
			configured: false,
		});
		const responses = await Promise.all([
			request("/admin/bootstrap", "POST", CREDENTIALS),
			request("/admin/bootstrap", "POST", CREDENTIALS),
		]);
		expect(responses.map((response) => response.status).sort()).toEqual([
			201, 409,
		]);
		expect(
			(await request("/admin/bootstrap", "POST", CREDENTIALS)).status,
		).toBe(409);
		expect(await (await request("/admin/setup")).json()).toEqual({
			configured: true,
		});
		expect(db.select().from(schema.administrator).all()).toHaveLength(1);
		expect(
			db.select().from(schema.administrator).get()?.passwordHash,
		).not.toContain(CREDENTIALS.password);
	});

	it("rejects weak bootstrap passwords", async () => {
		expect(
			(
				await request("/admin/bootstrap", "POST", {
					...CREDENTIALS,
					password: "short",
				})
			).status,
		).toBe(422);
		expect(service.isConfigured()).toBe(false);
	});

	it("rejects incorrect credentials without creating a session", async () => {
		await request("/admin/bootstrap", "POST", CREDENTIALS);
		for (const credentials of [
			{ ...CREDENTIALS, password: "incorrect-password" },
			{ ...CREDENTIALS, username: "someone-else" },
		]) {
			expect(
				(await request("/admin/sign-in", "POST", credentials)).status,
			).toBe(401);
		}
		expect(db.select().from(schema.administratorSessions).all()).toHaveLength(
			0,
		);
	});

	it("persists a session across requests and service instances, storing only a token hash", async () => {
		const cookie = await signIn();
		expect(
			(await request("/admin/session", "GET", undefined, cookie)).status,
		).toBe(200);
		expect(
			(await request("/admin/session", "GET", undefined, cookie)).status,
		).toBe(200);
		const restarted = createAdministratorService(
			() => db,
			() => now,
		);
		expect(
			restarted.authenticate(new Request(ORIGIN, { headers: { cookie } })),
		).toBe(true);
		expect(
			db.select().from(schema.administratorSessions).get()?.tokenHash,
		).not.toBe(cookie.split("=")[1]);
	});

	it("sets a secure, HttpOnly session cookie over HTTPS", async () => {
		await request("/admin/bootstrap", "POST", CREDENTIALS);
		const response = await api.handle(
			new Request("https://localhost/api/v1/admin/sign-in", {
				method: "POST",
				headers: {
					origin: "https://localhost",
					"content-type": "application/json",
				},
				body: JSON.stringify(CREDENTIALS),
			}),
		);
		const cookie = response.headers.get("set-cookie");
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("SameSite=Strict");
		expect(cookie).toContain("Secure");
		expect(cookie).toContain(`Max-Age=${SESSION_DURATION_SECONDS}`);
	});

	it("expires sessions at the exact deadline", async () => {
		const cookie = await signIn();
		now += SESSION_DURATION_SECONDS;
		expect(
			(await request("/admin/session", "GET", undefined, cookie)).status,
		).toBe(401);
	});

	it("revokes sign-out tokens on the server and clears the cookie", async () => {
		const cookie = await signIn();
		const response = await request(
			"/admin/sign-out",
			"POST",
			undefined,
			cookie,
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
		expect(
			(await request("/admin/session", "GET", undefined, cookie)).status,
		).toBe(401);
		expect(db.select().from(schema.administratorSessions).all()).toHaveLength(
			0,
		);
	});

	it("rejects unauthenticated APIs including Plex and unknown future routes", async () => {
		for (const path of [
			"/admin/session",
			"/auth/plex/login/start",
			"/configuration",
			"/sync",
		]) {
			expect((await request(path)).status).toBe(401);
		}
		expect(
			(
				await request(
					"/admin/session",
					"GET",
					undefined,
					"continuarr_session=forged",
				)
			).status,
		).toBe(401);
		expect((await request("/health")).status).toBe(200);
	});

	it("rejects cross-origin mutations, including public bootstrap", async () => {
		expect(
			(
				await request(
					"/admin/bootstrap",
					"POST",
					CREDENTIALS,
					undefined,
					"https://attacker.example",
				)
			).status,
		).toBe(403);
		const cookie = await signIn();
		expect(
			(
				await request(
					"/admin/sign-out",
					"POST",
					undefined,
					cookie,
					"https://attacker.example",
				)
			).status,
		).toBe(403);
		expect(
			(await request("/admin/session", "GET", undefined, cookie)).status,
		).toBe(200);
	});

	it("redirects private pages while allowing the sign-in flow", async () => {
		const response = guardRequest(new Request(`${ORIGIN}/plex`), service);
		expect(response?.status).toBe(303);
		expect(response?.headers.get("location")).toBe(`${ORIGIN}/sign-in`);
		expect(
			guardRequest(new Request(`${ORIGIN}/sign-in`), service),
		).toBeUndefined();
		const cookie = await signIn();
		expect(
			guardRequest(
				new Request(`${ORIGIN}/plex`, { headers: { cookie } }),
				service,
			),
		).toBeUndefined();
	});
});

it.each(["development", "production"])(
	"allows HTTP session cookies in %s mode",
	(environment) => {
		const previousEnvironment = process.env.NODE_ENV;
		try {
			process.env.NODE_ENV = environment;
			const cookie = sessionCookie(new Request(ORIGIN), "test-token");
			expect(cookie).not.toContain("; Secure");
			expect(cookie).toContain("HttpOnly");
			expect(cookie).toContain("SameSite=Strict");
		} finally {
			if (previousEnvironment === undefined) delete process.env.NODE_ENV;
			else process.env.NODE_ENV = previousEnvironment;
		}
	},
);
