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
	it("offers only owned servers and prefers a grant for a protected Home member", async () => {
		const baseUrl = serve((request) => {
			const path = new URL(request.url).pathname;
			if (path === "/api/v2/resources")
				return json([
					{
						clientIdentifier: "owned",
						name: "Nas",
						provides: "server",
						owned: true,
						accessToken: "owner-server-token",
						connections: [{ uri: "https://owned.example" }],
					},
					{
						clientIdentifier: "other",
						name: "Other",
						provides: "server",
						owned: false,
						accessToken: "other-token",
						connections: [{ uri: "https://other.example" }],
					},
				]);
			if (path === "/api/v2/home/users")
				return json({
					users: [
						{ id: 10, title: "Dad", protected: true },
						{ id: 12, title: "Mom", protected: true },
					],
				});
			if (path === "/api/users")
				return new Response(
					'<MediaContainer><User id="11" username="Friend"/></MediaContainer>',
				);
			if (path === "/api/servers/owned/shared_servers")
				return new Response(
					'<MediaContainer><SharedServer userID="10" acceptedAt="1" accessToken="dad-token"/><SharedServer userID="11" acceptedAt="2" accessToken="friend-token"/></MediaContainer>',
				);
			return json({}, 404);
		});
		const provider = createPlexProvider({
			clientIdentifier: PLEX_IDENTIFIER,
			plexUrl: baseUrl,
		});
		expect(
			(await provider.servers(new Secret("owner-token"))).map(({ id }) => id),
		).toEqual(["owned"]);
		const users = await provider.directory({
			token: new Secret("owner-token"),
			owner: { userId: "1", name: "Owner" },
			serverId: "owned",
		});
		expect(users.map(({ id, access }) => [id, access.kind])).toEqual([
			["1", "owner"],
			["10", "shared_grant"],
			["12", "unavailable"],
			["11", "shared_grant"],
		]);
		expect(users.find((user) => user.id === "11")?.name).toBe("Friend");
		const access = users.find((user) => user.id === "10")?.access;
		if (access?.kind !== "shared_grant") throw new Error("Missing Dad grant");
		expect(access.token.reveal()).toBe("dad-token");
	});
	it("uses OAuth owner identity and the granted user token for watched writes", async () => {
		let scrobbles = 0;
		const usedTokens: string[] = [];
		let baseUrl = "";
		baseUrl = serve((request) => {
			const path = new URL(request.url).pathname;
			const token = request.headers.get("X-Plex-Token") ?? "";
			if (path === "/api/v2/pins" && request.method === "POST")
				return json({ id: 7, code: "ABCD", expiresIn: 300 });
			if (path === "/api/v2/pins/7")
				return json({ id: 7, code: "ABCD", authToken: "owner-token" });
			if (path === "/api/v2/user")
				return token === "owner-token"
					? json({ id: 1, title: "Owner" })
					: json({}, 401);
			if (path === "/api/v2/resources")
				return json([
					{
						clientIdentifier: "machine",
						name: "Nas",
						provides: "server",
						owned: true,
						accessToken: "owner-token",
						connections: [{ uri: `${baseUrl}/plex` }],
					},
				]);
			if (path === "/api/v2/home/users")
				return json({ users: [{ id: 2, title: "Child", protected: true }] });
			if (path === "/api/servers/machine/shared_servers")
				return new Response(
					'<MediaContainer><SharedServer userID="2" acceptedAt="1" accessToken="grant-token"/></MediaContainer>',
				);
			if (path === "/plex/identity")
				return json({ MediaContainer: { machineIdentifier: "machine" } });
			if (path === "/plex/library/sections") {
				usedTokens.push(token);
				return json({
					MediaContainer: { Directory: [{ key: "3", type: "movie" }] },
				});
			}
			if (path === "/plex/library/sections/3/all")
				return json({
					MediaContainer: {
						totalSize: 1,
						offset: 0,
						Metadata: [
							{ ratingKey: "1", title: "Arrival", viewCount: scrobbles },
						],
					},
				});
			if (path === "/plex/library/metadata/1")
				return json({
					MediaContainer: {
						Metadata: [
							{ ratingKey: "1", title: "Arrival", viewCount: scrobbles },
						],
					},
				});
			if (path === "/plex/:/scrobble" && request.method === "PUT") {
				usedTokens.push(token);
				scrobbles++;
				return new Response(null, { status: 204 });
			}
			return json({}, 404);
		});
		const provider = createPlexProvider({
			clientIdentifier: PLEX_IDENTIFIER,
			plexUrl: baseUrl,
		});
		const pin = await provider.startLogin();
		const owner = await provider.pollLogin(pin);
		if (!owner) throw new Error("Missing OAuth owner");
		expect(owner.userId).toBe("1");
		const [server] = await provider.servers(owner.token);
		if (!server) throw new Error("Missing server");
		await provider.verifyServer(
			{ url: `${baseUrl}/plex`, token: owner.token },
			server.id,
		);
		const grant = (
			await provider.directory({
				token: owner.token,
				owner,
				serverId: server.id,
			})
		).find((user) => user.id === "2")?.access;
		if (grant?.kind !== "shared_grant") throw new Error("Missing grant");
		const access = { url: `${baseUrl}/plex`, token: grant.token };
		expect((await provider.items(access))[0]?.watched).toBe(false);
		await provider.markWatched(access, "1");
		await provider.markWatched(access, "1");
		expect(scrobbles).toBe(1);
		expect(usedTokens.slice(1)).toEqual(["grant-token", "grant-token"]);
	});
	it("reads every Plex page and rejects duplicate items", async () => {
		let duplicate = false;
		const starts: number[] = [];
		const baseUrl = serve((request) => {
			const path = new URL(request.url).pathname;
			if (path === "/plex/library/sections")
				return json({
					MediaContainer: { Directory: [{ key: "1", type: "movie" }] },
				});
			if (path === "/plex/library/sections/1/all") {
				const offset = Number(request.headers.get("X-Plex-Container-Start"));
				starts.push(offset);
				const entries = Array.from(
					{ length: offset === 0 ? PAGE_SIZE : 1 },
					(_, index) => ({
						ratingKey: String(duplicate && offset > 0 ? 1 : offset + index + 1),
						title: "Movie",
					}),
				);
				return json({
					MediaContainer: {
						totalSize: PAGE_SIZE + 1,
						offset,
						Metadata: entries,
					},
				});
			}
			return json({}, 404);
		});
		const provider = createPlexProvider({ clientIdentifier: PLEX_IDENTIFIER });
		const access = { url: `${baseUrl}/plex`, token: new Secret("grant-token") };
		expect(await provider.items(access)).toHaveLength(PAGE_SIZE + 1);
		expect(starts).toEqual([0, PAGE_SIZE]);
		duplicate = true;
		await expect(provider.items(access)).rejects.toThrow("duplicate item");
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
	it("rejects a partial required directory response", async () => {
		const baseUrl = serve((request) =>
			new URL(request.url).pathname === "/api/v2/home/users"
				? json({ users: [] })
				: json({}, 503),
		);
		const provider = createPlexProvider({
			clientIdentifier: PLEX_IDENTIFIER,
			plexUrl: baseUrl,
		});
		expect(
			provider.directory({
				token: new Secret("owner"),
				owner: { userId: "1", name: "Owner" },
				serverId: "owned",
			}),
		).rejects.toThrow();
	});
});

describe("Jellyfin provider", () => {
	it("keeps the API key on requests, reads every page, and marks once", async () => {
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
			if (url.pathname === "/jf/System/Info")
				return json({ Id: "server-1", ServerName: "Jellyfin" });
			if (
				request.headers.get("Authorization") !==
				'MediaBrowser Client="Continuarr", Device="server", DeviceId="jellyfin-client", Version="1.0.0", Token="user-token"'
			)
				return json({}, 401);
			if (url.pathname === "/jf/Users")
				return json([
					{
						Id: "user-1",
						Name: "Ian",
						ServerId: null,
						Policy: null,
						Configuration: { SubtitleMode: "Default" },
						ProviderIds: { custom: "remote-1" },
						LastActivityDate: "2026-09-26T12:00:00Z",
					},
				]);
			if (url.pathname === "/jf/Users/user-1")
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
		const directory = await provider.directory({
			url: `${baseUrl}/jf`,
			token: new Secret("user-token"),
		});
		expect(
			directory.users.map((user) => ({ id: user.id, name: user.name })),
		).toEqual([{ id: "user-1", name: "Ian" }]);
		expect(directory.users[0]?.details).toEqual({
			Id: "user-1",
			Name: "Ian",
			ServerId: null,
			Policy: null,
			Configuration: { SubtitleMode: "Default" },
			ProviderIds: { custom: "remote-1" },
			LastActivityDate: "2026-09-26T12:00:00Z",
		});
		const access = {
			url: `${baseUrl}/jf`,
			userId: "user-1",
			token: new Secret("user-token"),
		};
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

	it("rejects an invalid API key when listing users", async () => {
		const url = serve(() => json({}, 401));
		const provider = createJellyfinProvider({
			clientIdentifier: JELLYFIN_IDENTIFIER,
		});
		await expect(
			provider.directory({ url, token: new Secret("invalid-key") }),
		).rejects.toThrow("rejected these credentials");
	});

	it("rejects duplicate users", async () => {
		const url = serve((request) =>
			new URL(request.url).pathname === "/System/Info"
				? json({ Id: "server", ServerName: "Jellyfin" })
				: json([
						{ Id: "same", Name: "One" },
						{ Id: "same", Name: "Two" },
					]),
		);
		const provider = createJellyfinProvider({
			clientIdentifier: JELLYFIN_IDENTIFIER,
		});
		await expect(
			provider.directory({ url, token: new Secret("api-key") }),
		).rejects.toThrow("duplicate user");
	});

	it("rejects a user tagged with another server identity", async () => {
		const url = serve((request) =>
			new URL(request.url).pathname === "/System/Info"
				? json({ Id: "server", ServerName: "Jellyfin" })
				: json([{ Id: "user", Name: "Ian", ServerId: "other-server" }]),
		);
		const provider = createJellyfinProvider({
			clientIdentifier: JELLYFIN_IDENTIFIER,
		});
		await expect(
			provider.directory({ url, token: new Secret("api-key") }),
		).rejects.toThrow("different server");
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

describe("library display details", () => {
	it("reads Plex episode hierarchy and every media part path", async () => {
		const url = serve((request) =>
			new URL(request.url).pathname === "/library/sections"
				? json({ MediaContainer: { Directory: [{ key: "2", type: "show" }] } })
				: json({
						MediaContainer: {
							totalSize: 1,
							Metadata: [
								{
									ratingKey: "12",
									title: "Pilot",
									grandparentRatingKey: "show-7",
									grandparentTitle: "Example",
									parentIndex: 0,
									index: 1,
									Media: [
										{
											Part: [
												{ file: "/tv/pilot-a.mkv" },
												{ file: "/tv/pilot-b.mkv" },
											],
										},
									],
								},
							],
						},
					}),
		);
		const items = await createPlexProvider({
			clientIdentifier: PLEX_IDENTIFIER,
		}).items({ url, token: new Secret("token") });
		expect(items[0].details).toEqual({
			paths: ["/tv/pilot-a.mkv", "/tv/pilot-b.mkv"],
			showId: "show-7",
			showTitle: "Example",
			season: 0,
			episode: 1,
		});
	});
	it("requests Jellyfin paths and reads episode hierarchy without inventing missing metadata", async () => {
		const url = serve((request) => {
			expect(new URL(request.url).searchParams.get("Fields")).toBe(
				"ProviderIds,Path",
			);
			return json({
				TotalRecordCount: 2,
				Items: [
					{
						Id: "j1",
						Name: "Pilot",
						Type: "Episode",
						Path: "/shows/pilot.mkv",
						SeriesId: "series-7",
						SeriesName: "Example",
						ParentIndexNumber: 0,
						IndexNumber: 1,
						UserData: { Played: true },
					},
					{
						Id: "j2",
						Name: "Unknown",
						Type: "Episode",
						Path: null,
						SeriesId: null,
						SeriesName: null,
						ParentIndexNumber: null,
						IndexNumber: null,
						UserData: { Played: false },
					},
				],
			});
		});
		const items = await createJellyfinProvider({
			clientIdentifier: JELLYFIN_IDENTIFIER,
		}).items({ url, userId: "person", token: new Secret("token") });
		expect(items[0].details).toEqual({
			paths: ["/shows/pilot.mkv"],
			showId: "series-7",
			showTitle: "Example",
			season: 0,
			episode: 1,
		});
		expect(items[1].details?.paths).toBeUndefined();
		expect(items[1].details?.season).toBeUndefined();
		expect(items[1].ids).toEqual([]);
	});
});
