import { describe, expect, it } from "bun:test";
import { createJellyfinClient, normalizeServerUrl } from "./client";

const SERVER = "http://jellyfin.local/jellyfin";
const TOKEN = "private-token";
const LOGIN = { AccessToken: TOKEN, User: { Id: "user-id", Name: "Ian" } };
const CONNECTION = {
	serverUrl: SERVER,
	accessToken: TOKEN,
	user: { id: "user-id", name: "Ian" },
};

function transport(
	handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
	return Object.assign(
		async (input: string | URL | Request, init?: RequestInit) =>
			handler(String(input), init),
		{ preconnect() {} },
	);
}

describe("Jellyfin client", () => {
	it("preserves a reverse proxy base path and sends credentials only in the body", async () => {
		const client = createJellyfinClient(
			transport((url, init) => {
				expect(url).toBe(`${SERVER}/Users/AuthenticateByName`);
				expect(init?.method).toBe("POST");
				expect(JSON.parse(String(init?.body))).toEqual({
					Username: "Ian",
					Pw: "secret",
				});
				expect(new Headers(init?.headers).get("Authorization")).toContain(
					'Client="Continuarr"',
				);
				expect(init?.redirect).toBe("error");
				return Response.json(LOGIN);
			}),
		);
		expect(await client.login(`${SERVER}/`, "Ian", "secret")).toEqual(
			CONNECTION,
		);
	});

	it("rejects URLs containing credentials or unsupported components", () => {
		for (const url of [
			"file:///etc/passwd",
			"https://user:pass@host",
			"http://host?token=x",
			"http://host/#x",
			"host",
		]) {
			expect(() => normalizeServerUrl(url)).toThrow();
		}
	});

	it("reports authentication failures without exposing the upstream response", async () => {
		const client = createJellyfinClient(
			transport(() => new Response(TOKEN, { status: 401 })),
		);
		expect(client.login(SERVER, "Ian", "wrong")).rejects.toMatchObject({
			status: 401,
			message: "Jellyfin rejected these credentials or this session.",
		});
	});

	it("rejects incomplete authentication responses", async () => {
		const client = createJellyfinClient(
			transport(() => Response.json({ User: LOGIN.User })),
		);
		expect(client.login(SERVER, "Ian", "secret")).rejects.toThrow(
			"unexpected response",
		);
	});

	it("sanitizes transport errors", async () => {
		const client = createJellyfinClient(
			transport(() => {
				throw new Error(TOKEN);
			}),
		);
		expect(client.login(SERVER, "Ian", "secret")).rejects.toThrow(
			"Unable to reach",
		);
	});

	it("pulls only the authenticated user's views and bounded latest items", async () => {
		const paths: string[] = [];
		const client = createJellyfinClient(
			transport((url, init) => {
				paths.push(url);
				expect(new Headers(init?.headers).get("X-Emby-Token")).toBe(TOKEN);
				if (url.endsWith("System/Info/Public"))
					return Response.json({
						Id: "server",
						ServerName: "Home",
						Version: "10.11",
					});
				if (url.endsWith("/Views"))
					return Response.json({ Items: [{ Id: "movies", Name: "Movies" }] });
				return Response.json([
					{ Id: "movie", Name: "Arrival", Type: "Movie", ProductionYear: 2016 },
				]);
			}),
		);
		const result = await client.overview(CONNECTION);
		expect(paths).toContain(`${SERVER}/Users/user-id/Views`);
		expect(paths).toContain(`${SERVER}/Users/user-id/Items/Latest?Limit=12`);
		expect(result.libraries).toEqual([
			{ id: "movies", name: "Movies", type: null, year: null },
		]);
		expect(result.recent[0]?.name).toBe("Arrival");
		expect(JSON.stringify(result)).not.toContain(TOKEN);
	});

	it("rejects invalid overview data instead of rendering an incomplete result", async () => {
		const client = createJellyfinClient(transport(() => Response.json({})));
		expect(client.overview(CONNECTION)).rejects.toThrow("unexpected response");
	});
});
