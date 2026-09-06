import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { type JellyfinClient, JellyfinError } from "~/backend/jellyfin/client";
import { createJellyfinRoutes } from "./controller";

const ORIGIN = "https://continuarr.local";
const BASE = `${ORIGIN}/api/v1/auth/jellyfin`;
const CREDENTIALS = {
	serverUrl: "http://jellyfin.local",
	username: "Ian",
	password: "secret",
};
const CONNECTION = {
	serverUrl: CREDENTIALS.serverUrl,
	accessToken: "private-token",
	user: { id: "ian", name: "Ian" },
};
const OVERVIEW = {
	user: CONNECTION.user,
	server: {
		id: "server",
		name: "Home",
		version: "10.11",
		url: CONNECTION.serverUrl,
	},
	libraries: [],
	recent: [],
};
const CLIENT: JellyfinClient = {
	login: async () => CONNECTION,
	overview: async () => OVERVIEW,
};

function app(client = CLIENT, now?: () => number) {
	return new Elysia({ prefix: "/api/v1/auth" }).use(
		createJellyfinRoutes(client, now),
	);
}
function loginRequest(origin = ORIGIN) {
	return new Request(`${BASE}/login`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-continuarr-request": "1",
			origin,
		},
		body: JSON.stringify(CREDENTIALS),
	});
}
function sessionCookie(response: Response) {
	return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}
function overviewRequest(cookie: string) {
	return new Request(`${BASE}/overview`, { headers: { cookie } });
}

describe("Jellyfin session routes", () => {
	it("keeps tokens server-side and sets a secure HttpOnly cookie", async () => {
		const response = await app().handle(loginRequest());
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			user: CONNECTION.user,
			serverUrl: CONNECTION.serverUrl,
		});
		const cookie = response.headers.get("set-cookie") ?? "";
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("Secure");
		expect(cookie).toContain("SameSite=Strict");
		expect(cookie).not.toContain(CONNECTION.accessToken);
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it("requires login before contacting Jellyfin", async () => {
		const response = await app().handle(overviewRequest(""));
		expect(response.status).toBe(401);
	});

	it("uses the browser's connection to retrieve its overview", async () => {
		const api = app({
			...CLIENT,
			overview: async (connection) => {
				expect(connection).toEqual(CONNECTION);
				return OVERVIEW;
			},
		});
		const login = await api.handle(loginRequest());
		const response = await api.handle(overviewRequest(sessionCookie(login)));
		expect(await response.json()).toEqual(OVERVIEW);
	});

	it("does not share a logged-in connection with another browser", async () => {
		const api = app();
		await api.handle(loginRequest());
		expect(
			(await api.handle(overviewRequest("continuarr_jellyfin=unknown"))).status,
		).toBe(401);
	});

	it("expires sessions after eight hours", async () => {
		let now = 0;
		const api = app(CLIENT, () => now);
		const login = await api.handle(loginRequest());
		now = 8 * 60 * 60 * 1_000;
		expect(
			(await api.handle(overviewRequest(sessionCookie(login)))).status,
		).toBe(401);
	});

	it("invalidates a session on logout", async () => {
		const api = app();
		const cookie = sessionCookie(await api.handle(loginRequest()));
		const logout = await api.handle(
			new Request(`${BASE}/logout`, {
				method: "POST",
				headers: { cookie, "x-continuarr-request": "1" },
			}),
		);
		expect(logout.status).toBe(200);
		expect((await api.handle(overviewRequest(cookie))).status).toBe(401);
	});

	it("rejects cross-origin login", async () => {
		expect(
			(await app().handle(loginRequest("https://other.local"))).status,
		).toBe(403);
	});

	it("rejects mutations without the custom request header", async () => {
		const request = loginRequest();
		request.headers.delete("x-continuarr-request");
		expect((await app().handle(request)).status).toBe(403);
	});

	it("returns a sanitized authentication error without a session cookie", async () => {
		const api = app({
			...CLIENT,
			login: async () => {
				throw new JellyfinError("Invalid credentials", 401);
			},
		});
		const response = await api.handle(loginRequest());
		expect(response.status).toBe(401);
		expect(response.headers.get("set-cookie")).toBeNull();
	});

	it("forgets a token rejected by Jellyfin", async () => {
		let requests = 0;
		const api = app({
			...CLIENT,
			overview: async () => {
				requests++;
				throw new JellyfinError("Session expired", 401);
			},
		});
		const cookie = sessionCookie(await api.handle(loginRequest()));
		await api.handle(overviewRequest(cookie));
		await api.handle(overviewRequest(cookie));
		expect(requests).toBe(1);
	});
});
