/// <reference types="bun" />

import { afterEach, describe, expect, it } from "bun:test";
import { createJellyfinProvider } from "~/backend/media/jellyfin";
import { createPlexProvider } from "~/backend/media/plex";
import { Secret } from "~/backend/secrets/storage";

const PAGE_SIZE = 100;
const PLEX_IDENTIFIER = "plex-client";
const JELLYFIN_IDENTIFIER = "jellyfin-client";
const servers: Array<ReturnType<typeof Bun.serve>> = [];

function serve(handler: (request: Request) => Response | Promise<Response>) {
	const server = Bun.serve({ port: 0, fetch: handler });
	servers.push(server);
	return server.url.toString().replace(/\/$/, "");
}

function json(value: unknown, status = 200) {
	return Response.json(value, { status });
}

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true);
});

describe("Plex provider", () => {
	it("skips inaccessible servers without hiding usable resources", async () => {
		const baseUrl = serve(() =>
			json([
				{
					clientIdentifier: "missing-token",
					name: "No access",
					provides: "server",
					connections: [{ uri: "https://example.com" }],
				},
				{
					clientIdentifier: "missing-connections",
					name: "Offline",
					provides: "server",
					accessToken: "unused",
				},
				{
					clientIdentifier: "empty-connections",
					name: "Offline",
					provides: "server",
					accessToken: "unused",
					connections: [],
				},
				{
					clientIdentifier: "usable",
					name: "Available",
					provides: "server",
					accessToken: "server-token",
					connections: [{ uri: "https://example.com" }],
				},
			]),
		);
		const provider = createPlexProvider({
			clientIdentifier: PLEX_IDENTIFIER,
			plexUrl: baseUrl,
		});
		const resources = await provider.servers(new Secret("profile-token"));
		expect(
			resources.map(({ id, name, connections, token }) => ({
				id,
				name,
				connections,
				token: token.reveal(),
			})),
		).toEqual([
			{
				id: "usable",
				name: "Available",
				connections: ["https://example.com"],
				token: "server-token",
			},
		]);
	});

	it("keeps Home and server tokens separate while reading every page and marking once", async () => {
		let baseUrl = "";
		let scrobbles = 0;
		const pageStarts: number[] = [];
		const metadata = Array.from({ length: PAGE_SIZE + 1 }, (_, index) => ({
			ratingKey: String(index + 1),
			title: `Movie ${index + 1}`,
			Guid: [{ id: `imdb://tt${String(index + 1).padStart(7, "0")}` }],
			viewCount: index === 0 ? scrobbles : 0,
		}));
		baseUrl = serve((request) => {
			const url = new URL(request.url);
			const token = request.headers.get("X-Plex-Token");
			if (url.pathname === "/api/v2/pins" && request.method === "POST") {
				return json({ id: 7, code: "ABCD", expiresIn: 300 });
			}
			if (url.pathname === "/api/v2/pins/7")
				return json({ id: 7, code: "ABCD", authToken: "owner-token" });
			if (url.pathname === "/api/v2/user") {
				if (token === "owner-token") return json({ id: 1, title: "Owner" });
				if (token === "profile-token") return json({ id: 2, title: "Child" });
				return json({}, 401);
			}
			if (url.pathname === "/api/home/users") {
				if (token !== "owner-token") return json({}, 401);
				return json({
					MediaContainer: {
						User: [{ id: 2, title: "Child", protected: true }],
					},
				});
			}
			if (url.pathname === "/api/home/users/2/switch") {
				if (token !== "owner-token" || url.searchParams.get("pin") !== "1234")
					return json({}, 401);
				return json({ authenticationToken: "profile-token" });
			}
			if (url.pathname === "/api/v2/resources") {
				if (token !== "profile-token") return json({}, 401);
				return json([
					{ clientIdentifier: "player-1", name: "Player", provides: "player" },
					{
						clientIdentifier: "machine-1",
						name: "Plex",
						provides: "server",
						accessToken: "server-token",
						connections: [{ uri: `${baseUrl}/plex` }],
					},
				]);
			}
			if (token !== "server-token") return json({}, 401);
			if (url.pathname === "/plex/identity")
				return json({ MediaContainer: { machineIdentifier: "machine-1" } });
			if (url.pathname === "/plex/library/sections")
				return json({
					MediaContainer: { Directory: [{ key: "3", type: "movie" }] },
				});
			if (url.pathname === "/plex/library/sections/3/all") {
				const offset = Number(request.headers.get("X-Plex-Container-Start"));
				pageStarts.push(offset);
				return json({
					MediaContainer: {
						totalSize: metadata.length,
						offset,
						Metadata: metadata.slice(offset, offset + PAGE_SIZE),
					},
				});
			}
			if (url.pathname === "/plex/library/metadata/1")
				return json({
					MediaContainer: {
						Metadata: [{ ...metadata[0], viewCount: scrobbles }],
					},
				});
			if (url.pathname === "/plex/:/scrobble" && request.method === "PUT") {
				scrobbles++;
				return new Response(null, { status: 204 });
			}
			return json({}, 404);
		});
		const provider = createPlexProvider({
			clientIdentifier: PLEX_IDENTIFIER,
			plexUrl: `${baseUrl}/api/v2`,
		});
		const pin = await provider.startLogin();
		expect(pin).toEqual({
			id: 7,
			code: "ABCD",
			expiresIn: 300,
			authorizationUrl: expect.stringContaining("clientID=plex-client"),
		});
		const owner = await provider.pollLogin(pin);
		expect(owner?.userId).toBe("1");
		if (!owner) throw new Error("Missing owner");
		expect(await provider.homeUsers(owner.token)).toEqual([
			{ id: "2", name: "Child", protected: true },
		]);
		const profile = await provider.switchUser({
			token: owner.token,
			userId: "2",
			pin: "1234",
		});
		expect(profile.name).toBe("Child");
		const [server] = await provider.servers(profile.token);
		expect(server?.id).toBe("machine-1");
		if (!server) throw new Error("Missing Plex server");
		const access = { url: server.connections[0] ?? "", token: server.token };
		await provider.verifyServer(access, server.id);
		const items = await provider.items(access);
		expect(items).toHaveLength(PAGE_SIZE + 1);
		expect(items[0]).toEqual({
			id: "1",
			kind: "movie",
			title: "Movie 1",
			ids: [{ provider: "imdb", value: "tt0000001" }],
			watched: false,
		});
		expect(pageStarts).toEqual([0, PAGE_SIZE]);
		await provider.markWatched(access, "1");
		await provider.markWatched(access, "1");
		expect(scrobbles).toBe(1);
	});

	it("rejects an incomplete inventory", async () => {
		const baseUrl = serve((request) => {
			const path = new URL(request.url).pathname;
			if (path === "/plex/library/sections")
				return json({
					MediaContainer: { Directory: [{ key: "1", type: "movie" }] },
				});
			if (path === "/plex/library/sections/1/all")
				return json({
					MediaContainer: {
						totalSize: 2,
						offset: 0,
						Metadata: [{ ratingKey: "1", title: "One" }],
					},
				});
			return json({}, 404);
		});
		const provider = createPlexProvider({ clientIdentifier: PLEX_IDENTIFIER });
		await expect(
			provider.items({ url: `${baseUrl}/plex`, token: new Secret("token") }),
		).rejects.toThrow("incomplete library page");
	});

	it("does not follow a credentialed redirect", async () => {
		let redirected = false;
		const baseUrl = serve((request) => {
			const path = new URL(request.url).pathname;
			if (path === "/plex/library/sections") {
				return Response.redirect(`${baseUrl}/capture`, 302);
			}
			if (path === "/capture") redirected = true;
			return json({}, 404);
		});
		const provider = createPlexProvider({ clientIdentifier: PLEX_IDENTIFIER });
		await expect(
			provider.items({
				url: `${baseUrl}/plex`,
				token: new Secret("private-token"),
			}),
		).rejects.toThrow("request failed");
		expect(redirected).toBe(false);
	});

	it("rejects a switched token for another profile", async () => {
		const baseUrl = serve((request) => {
			const path = new URL(request.url).pathname;
			if (path === "/api/home/users/2/switch") {
				return json({ authenticationToken: "wrong-profile-token" });
			}
			if (path === "/api/v2/user")
				return json({ id: 3, title: "Another user" });
			return json({}, 404);
		});
		const provider = createPlexProvider({
			clientIdentifier: PLEX_IDENTIFIER,
			plexUrl: baseUrl,
		});
		await expect(
			provider.switchUser({ token: new Secret("owner-token"), userId: "2" }),
		).rejects.toThrow("different Home user");
	});

	it("checks library access before accepting a Plex server", async () => {
		const baseUrl = serve((request) => {
			const path = new URL(request.url).pathname;
			if (path === "/plex/identity") {
				return json({ MediaContainer: { machineIdentifier: "machine-1" } });
			}
			return json({}, 401);
		});
		const provider = createPlexProvider({ clientIdentifier: PLEX_IDENTIFIER });
		await expect(
			provider.verifyServer(
				{ url: `${baseUrl}/plex`, token: new Secret("bad-token") },
				"machine-1",
			),
		).rejects.toThrow("rejected these credentials");
	});
});

describe("Jellyfin provider", () => {
	it("keeps the user token on requests, reads every page, and marks once", async () => {
		let played = false;
		let marks = 0;
		const starts: number[] = [];
		const library = Array.from({ length: PAGE_SIZE + 1 }, (_, index) => ({
			Id: `item-${index + 1}`,
			Name: `Film ${index + 1}`,
			Type: "Movie",
			ProviderIds: { Imdb: `tt${String(index + 1).padStart(7, "0")}` },
			UserData: { Played: false },
		}));
		const baseUrl = serve((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/jf/System/Info/Public")
				return json({ Id: "server-1", ServerName: "Jellyfin" });
			if (url.pathname === "/jf/Users/AuthenticateByName")
				return json({
					AccessToken: "user-token",
					User: { Id: "user-1", Name: "Ian" },
					ServerId: "server-1",
				});
			if (
				request.headers.get("Authorization") !==
				'MediaBrowser Client="Continuarr", Device="server", DeviceId="jellyfin-client", Version="1.0.0", Token="user-token"'
			)
				return json({}, 401);
			if (url.pathname === "/jf/Users/Me")
				return json({ Id: "user-1", Name: "Ian" });
			if (url.pathname === "/jf/Users/user-1/Items") {
				const offset = Number(url.searchParams.get("StartIndex"));
				starts.push(offset);
				return json({
					Items: library.slice(offset, offset + PAGE_SIZE),
					TotalRecordCount: library.length,
				});
			}
			if (url.pathname === "/jf/Users/user-1/Items/item-1")
				return json({ Id: "item-1", UserData: { Played: played } });
			if (
				url.pathname === "/jf/Users/user-1/PlayedItems/item-1" &&
				request.method === "POST"
			) {
				played = true;
				marks++;
				return new Response(null, { status: 204 });
			}
			return json({}, 404);
		});
		const provider = createJellyfinProvider({
			clientIdentifier: JELLYFIN_IDENTIFIER,
		});
		const access = await provider.login({
			url: `${baseUrl}/jf`,
			username: "user",
			password: "password",
		});
		expect(access.serverId).toBe("server-1");
		expect(access.userId).toBe("user-1");
		expect(access.name).toBe("Ian");
		const items = await provider.items(access);
		expect(items).toHaveLength(PAGE_SIZE + 1);
		expect(items[0]).toEqual({
			id: "item-1",
			kind: "movie",
			title: "Film 1",
			ids: [{ provider: "imdb", value: "tt0000001" }],
			watched: false,
		});
		expect(starts).toEqual([0, PAGE_SIZE]);
		await provider.markWatched(access, "item-1");
		await provider.markWatched(access, "item-1");
		expect(marks).toBe(1);
	});

	it("rejects a response without played state", async () => {
		const baseUrl = serve(() =>
			json({
				Items: [{ Id: "item", Name: "Film", Type: "Movie" }],
				TotalRecordCount: 1,
			}),
		);
		const provider = createJellyfinProvider({
			clientIdentifier: JELLYFIN_IDENTIFIER,
		});
		await expect(
			provider.items({
				url: baseUrl,
				userId: "user",
				token: new Secret("token"),
			}),
		).rejects.toThrow("unexpected response");
	});
});

it("keeps direct episode identifiers and rejects series paths as episode identifiers", async () => {
	const baseUrl = serve((request) => {
		const path = new URL(request.url).pathname;
		if (path === "/library/sections")
			return json({
				MediaContainer: { Directory: [{ key: "1", type: "show" }] },
			});
		if (path === "/library/sections/1/all")
			return json({
				MediaContainer: {
					totalSize: 2,
					offset: 0,
					Metadata: [
						{
							ratingKey: "1",
							title: "Pilot",
							Guid: [{ id: "tvdb://121361/1/1" }],
						},
						{
							ratingKey: "2",
							title: "Second",
							Guid: [{ id: "tvdb://349232" }],
						},
					],
				},
			});
		return json({}, 404);
	});
	const provider = createPlexProvider({ clientIdentifier: PLEX_IDENTIFIER });
	expect(
		await provider.items({ url: baseUrl, token: new Secret("token") }),
	).toEqual([
		{ id: "1", kind: "episode", title: "Pilot", ids: [], watched: false },
		{
			id: "2",
			kind: "episode",
			title: "Second",
			ids: [{ provider: "tvdb", value: "349232" }],
			watched: false,
		},
	]);
});

it("validates the identity of a wrapped legacy Plex Home switch response", async () => {
	const baseUrl = serve((request) => {
		const path = new URL(request.url).pathname;
		if (path === "/api/home/users/2/switch")
			return json({ user: { authenticationToken: "managed-token" } });
		if (
			path === "/api/v2/user" &&
			request.headers.get("X-Plex-Token") === "managed-token"
		)
			return json({ id: 2, title: "Child" });
		return json({}, 401);
	});
	const provider = createPlexProvider({
		clientIdentifier: PLEX_IDENTIFIER,
		plexUrl: `${baseUrl}/api/v2`,
	});
	const user = await provider.switchUser({
		token: new Secret("owner"),
		userId: "2",
		pin: "1234",
	});
	expect(user.userId).toBe("2");
	expect(user.name).toBe("Child");
	expect(user.token.reveal()).toBe("managed-token");
});
