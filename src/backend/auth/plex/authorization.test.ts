import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import {
	createAdministratorService,
	SESSION_COOKIE,
} from "~/backend/admin/service";
import { createApi } from "~/backend/api";
import {
	createPlexPinClient,
	MILLISECONDS_PER_SECOND,
} from "~/backend/auth/plex/client";
import { createPlexAttemptRepository } from "~/backend/auth/plex/repo";
import { createPlexAuthorizationService } from "~/backend/auth/plex/service";
import * as schema from "~/db/schema";

const ORIGIN = "http://localhost";
const START_PATH = "/api/v1/auth/plex/login/start";
const OWNER_ID = 1;
const TOKEN_LENGTH = 64;
const SESSION_TOKEN = "a".repeat(TOKEN_LENGTH);
const OTHER_SESSION_TOKEN = "b".repeat(TOKEN_LENGTH);
const hash = (token: string) =>
	createHash("sha256").update(token).digest("hex");
const SESSION_HASH = hash(SESSION_TOKEN);
const OTHER_SESSION_HASH = hash(OTHER_SESSION_TOKEN);
const INITIAL_TIME = 1_800_000_000;
const PIN_LIFETIME_SECONDS = 300;
const SESSION_LIFETIME_SECONDS = 600;
const PIN = {
	id: 12345,
	code: "strong+pin&code",
	expiresAt: new Date(
		(INITIAL_TIME + PIN_LIFETIME_SECONDS) * MILLISECONDS_PER_SECOND,
	).toISOString(),
};
const SECRET = "upstream-account-token-must-not-leak";
let client: Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let now: number;
let upstreamBody: unknown;
let transport: ReturnType<typeof mock<(request: Request) => Promise<Response>>>;
let repository: ReturnType<typeof createPlexAttemptRepository>;
let administrator: ReturnType<typeof createAdministratorService>;
let api: ReturnType<typeof createApi>;

beforeEach(() => {
	client = new Database(":memory:");
	client.exec("PRAGMA foreign_keys = ON");
	db = drizzle({ client, schema });
	migrate(db, { migrationsFolder: "drizzle" });
	now = INITIAL_TIME;
	db.insert(schema.administrator)
		.values({ id: OWNER_ID, username: "owner", passwordHash: "unused" })
		.run();
	db.insert(schema.administratorSessions)
		.values(
			[SESSION_HASH, OTHER_SESSION_HASH].map((tokenHash) => ({
				tokenHash,
				administratorId: OWNER_ID,
				expiresAt: INITIAL_TIME + SESSION_LIFETIME_SECONDS,
			})),
		)
		.run();
	upstreamBody = { ...PIN, authToken: SECRET };
	transport = mock(async (_request: Request) => Response.json(upstreamBody));
	repository = createPlexAttemptRepository(() => db);
	administrator = createAdministratorService(
		() => db,
		() => now,
	);
	api = createApi(
		administrator,
		createPlexAuthorizationService(
			repository,
			createPlexPinClient(transport),
			() => now,
		),
	);
});
afterEach(() => client.close());

function request(
	method = "POST",
	token: string | null = SESSION_TOKEN,
	origin: string | null = ORIGIN,
) {
	return api.handle(
		new Request(`${ORIGIN}${START_PATH}`, {
			method,
			headers: {
				...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
				...(origin ? { origin } : {}),
			},
		}),
	);
}
function attempt() {
	const row = db.select().from(schema.authorizationAttempts).get();
	if (!row) throw new Error("Expected persisted attempt");
	return row;
}

it("requests a strong PIN with the exact client identity and validates the protocol boundary", async () => {
	const createPin = createPlexPinClient(transport);
	const result = await createPin("test-client");
	const sent = transport.mock.calls[0]?.[0];
	expect(sent?.url).toBe("https://plex.tv/api/v2/pins");
	expect(sent?.method).toBe("POST");
	expect(sent?.headers.get("X-Plex-Client-Identifier")).toBe("test-client");
	expect(sent?.headers.get("X-Plex-Product")).toBe("Continuarr");
	expect(sent?.headers.get("accept")).toBe("application/json");
	expect(sent?.headers.get("X-Plex-Token")).toBeNull();
	expect(sent?.redirect).toBe("error");
	expect(await sent?.text()).toBe("strong=true");
	expect(result).toEqual(PIN);
});

it("returns only the authorization URL and expiry after persisting the session-bound PIN", async () => {
	const response = await request();
	expect(response.status).toBe(200);
	expect(response.headers.get("cache-control")).toBe("no-store");
	const body = await response.json();
	expect(Object.keys(body).sort()).toEqual(["authorizationUrl", "expiresAt"]);
	expect(body.expiresAt).toBe(PIN.expiresAt);
	const url = new URL(body.authorizationUrl);
	expect(url.origin).toBe("https://app.plex.tv");
	const params = new URLSearchParams(url.hash.slice("#!?".length));
	expect(params.get("code")).toBe(PIN.code);
	const returned = new URL(params.get("forwardUrl") ?? "");
	expect(returned.origin).toBe(ORIGIN);
	expect(returned.pathname).toBe("/plex/");
	const row = attempt();
	expect(returned.searchParams.get("state")).toBe(row.state);
	expect(row).toMatchObject({
		service: "plex",
		sessionHash: SESSION_HASH,
		status: "pending",
		createdAt: now,
		expiresAt: INITIAL_TIME + PIN_LIFETIME_SECONDS,
	});
	const detail = db.select().from(schema.plexAuthorizationAttempts).get();
	expect(detail).toEqual({
		state: row.state,
		pinId: PIN.id,
		clientIdentifier: params.get("clientID") ?? "",
	});
	expect(
		transport.mock.calls[0]?.[0].headers.get("X-Plex-Client-Identifier"),
	).toBe(detail?.clientIdentifier ?? null);
	expect(JSON.stringify(body)).not.toContain(SECRET);
	expect(JSON.stringify(body)).not.toContain(SESSION_HASH);
	expect(JSON.stringify([row, detail])).not.toContain(SECRET);
	expect(JSON.stringify([row, detail])).not.toContain(SESSION_TOKEN);
	expect(JSON.stringify([row, detail])).not.toContain(PIN.code);
});

it.each([
	["missing session", null, ORIGIN, 401],
	["forged session", "c".repeat(TOKEN_LENGTH), ORIGIN, 401],
	["cross-origin", SESSION_TOKEN, "https://attacker.example", 403],
	["missing origin", SESSION_TOKEN, null, 403],
] as const)(
	"rejects %s before contacting Plex",
	async (_name, token, origin, status) => {
		expect((await request("POST", token, origin)).status).toBe(status);
		expect(transport).not.toHaveBeenCalled();
		expect(db.select().from(schema.authorizationAttempts).all()).toHaveLength(
			0,
		);
	},
);

it("removes the state-changing GET route", async () => {
	expect((await request("GET")).status).toBe(404);
	expect(transport).not.toHaveBeenCalled();
});
it("rejects an expired administrator session before starting", async () => {
	now += SESSION_LIFETIME_SECONDS;
	expect((await request()).status).toBe(401);
	expect(transport).not.toHaveBeenCalled();
});

it.each([
	["missing ID", { code: PIN.code, expiresAt: PIN.expiresAt }],
	["invalid ID", { ...PIN, id: -1 }],
	["missing code", { ...PIN, code: "" }],
	["invalid expiry", { ...PIN, expiresAt: "tomorrow" }],
	[
		"expired PIN",
		{
			...PIN,
			expiresAt: new Date(INITIAL_TIME * MILLISECONDS_PER_SECOND).toISOString(),
		},
	],
] as const)("records a sanitized failure for %s", async (_name, body) => {
	upstreamBody = { ...body, authToken: SECRET };
	const response = await request();
	expect(response.status).toBe(502);
	expect(await response.text()).not.toContain(SECRET);
	expect(attempt()).toMatchObject({
		status: "failed",
		failureCode: "plex_unavailable",
		finishedAt: now,
	});
	expect(repository.pending(attempt().state, SESSION_HASH, now)).toBeNull();
});

it.each(["http", "network", "invalid json", "timeout"])(
	"sanitizes %s failures",
	async (failure) => {
		transport.mockImplementation(async () => {
			if (failure === "http") return new Response(SECRET, { status: 503 });
			if (failure === "invalid json") return new Response(SECRET);
			if (failure === "timeout") throw new DOMException(SECRET, "TimeoutError");
			throw new Error(SECRET);
		});
		const response = await request();
		expect(response.status).toBe(502);
		expect(await response.text()).not.toContain(SECRET);
		expect(JSON.stringify(attempt())).not.toContain(SECRET);
	},
);

it.each(["revoked", "expired"])(
	"rejects a session %s while Plex is responding and retains history",
	async (ending) => {
		transport.mockImplementation(async () => {
			if (ending === "revoked")
				db.delete(schema.administratorSessions)
					.where(eq(schema.administratorSessions.tokenHash, SESSION_HASH))
					.run();
			else now += SESSION_LIFETIME_SECONDS;
			return Response.json({
				...PIN,
				expiresAt: new Date(
					(now + PIN_LIFETIME_SECONDS) * MILLISECONDS_PER_SECOND,
				).toISOString(),
			});
		});
		expect((await request()).status).toBe(401);
		expect(attempt()).toMatchObject({
			status: "failed",
			failureCode: "session_ended",
		});
		expect(repository.consume(attempt().state, SESSION_HASH, now)).toBe(false);
	},
);

it("keeps simultaneous starts distinct", async () => {
	const responses = await Promise.all([request(), request()]);
	expect(responses.map((response) => response.status)).toEqual([200, 200]);
	const rows = db.select().from(schema.authorizationAttempts).all();
	expect(new Set(rows.map((row) => row.state)).size).toBe(2);
	const pins = db.select().from(schema.plexAuthorizationAttempts).all();
	expect(new Set(pins.map((row) => row.clientIdentifier)).size).toBe(2);
});

it("rolls back partial persistence and returns a sanitized database failure", async () => {
	client.exec(
		"CREATE TRIGGER reject_pin BEFORE INSERT ON plex_authorization_attempts BEGIN SELECT RAISE(ABORT, 'private-database-error'); END;",
	);
	const response = await request();
	expect(response.status).toBe(500);
	expect(await response.text()).not.toContain("private-database-error");
	expect(db.select().from(schema.authorizationAttempts).all()).toHaveLength(0);
	expect(transport).not.toHaveBeenCalled();
});

describe("pending authorization validation", () => {
	beforeEach(async () => {
		expect((await request()).status).toBe(200);
	});

	it("survives repository recreation without consuming a pending PIN", () => {
		const restarted = createPlexAttemptRepository(() => db);
		expect(restarted.pending(attempt().state, SESSION_HASH, now)).toMatchObject(
			{ pinId: PIN.id },
		);
		expect(restarted.pending(attempt().state, SESSION_HASH, now)).toMatchObject(
			{ pinId: PIN.id },
		);
		expect(attempt().status).toBe("pending");
	});
	it("rejects a different active session without consuming the owner's attempt", () => {
		const state = attempt().state;
		expect(repository.pending(state, OTHER_SESSION_HASH, now)).toBeNull();
		expect(repository.consume(state, OTHER_SESSION_HASH, now)).toBe(false);
		expect(repository.consume(state, SESSION_HASH, now)).toBe(true);
	});
	it("rejects unknown state", () => {
		expect(repository.pending("unknown", SESSION_HASH, now)).toBeNull();
		expect(repository.consume("unknown", SESSION_HASH, now)).toBe(false);
	});
	it("rejects an attempt at its exact expiry", () => {
		now += PIN_LIFETIME_SECONDS;
		expect(repository.pending(attempt().state, SESSION_HASH, now)).toBeNull();
		expect(repository.consume(attempt().state, SESSION_HASH, now)).toBe(false);
	});
	it("rejects revoked sessions while preserving their attempt history", () => {
		administrator.signOut(
			new Request(ORIGIN, {
				headers: { cookie: `${SESSION_COOKIE}=${SESSION_TOKEN}` },
			}),
		);
		expect(repository.pending(attempt().state, SESSION_HASH, now)).toBeNull();
		expect(repository.consume(attempt().state, SESSION_HASH, now)).toBe(false);
		expect(attempt().sessionHash).toBe(SESSION_HASH);
	});
	it("rejects a session that expires before the PIN", () => {
		db.update(schema.administratorSessions)
			.set({ expiresAt: now })
			.where(eq(schema.administratorSessions.tokenHash, SESSION_HASH))
			.run();
		expect(repository.pending(attempt().state, SESSION_HASH, now)).toBeNull();
		expect(repository.consume(attempt().state, SESSION_HASH, now)).toBe(false);
	});
	it("allows only one competing completion and rejects replay", async () => {
		const state = attempt().state;
		const otherRepository = createPlexAttemptRepository(() => db);
		const outcomes = await Promise.all(
			[repository, otherRepository].map(async (repo) =>
				repo.consume(state, SESSION_HASH, now),
			),
		);
		expect(outcomes.filter(Boolean)).toHaveLength(1);
		expect(repository.consume(state, SESSION_HASH, now)).toBe(false);
		expect(repository.pending(state, SESSION_HASH, now)).toBeNull();
		expect(attempt()).toMatchObject({ status: "consumed", finishedAt: now });
	});
});
