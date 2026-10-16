/// <reference types="bun" />

import { afterEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import {
	createJellyfinProvider,
	TICKS_PER_MILLISECOND,
} from "~/backend/media/jellyfin";
import type { MediaItem } from "~/backend/media/model";
import { createPlexProvider } from "~/backend/media/plex";
import { Secret } from "~/backend/secrets/storage";

const PAGE_SIZE = 100;
const RESUME_POSITION_MS = 754_000;
// The scan saw 20:00, the plan copies 30:00, and playback reached 40:00 before the write.
const SCANNED_POSITION_MS = 1_200_000;
const PLANNED_POSITION_MS = 1_800_000;
const ADVANCED_POSITION_MS = 2_400_000;
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

function episodeIdentity(item: MediaItem | undefined) {
	return item?.kind === "episode" ? item.episode : null;
}

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true);
});

describe("Plex provider", () => {
	it("writes the resume position once and skips the identical repeat", async () => {
		const INITIAL_POSITION_MS = 100_000;
		let viewOffset = INITIAL_POSITION_MS;
		const writes: Array<{
			token: string | null;
			query: Record<string, string>;
		}> = [];
		const baseUrl = serve((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/plex/library/metadata/2")
				return json({
					MediaContainer: { Metadata: [{ ratingKey: "2", viewOffset }] },
				});
			if (url.pathname === "/plex/:/progress" && request.method === "PUT") {
				writes.push({
					token: request.headers.get("x-plex-token"),
					query: Object.fromEntries(url.searchParams),
				});
				viewOffset = Number(url.searchParams.get("time"));
				return new Response(null, { status: 200 });
			}
			return json({}, 404);
		});
		const provider = createPlexProvider({ clientIdentifier: PLEX_IDENTIFIER });
		const access = { url: `${baseUrl}/plex`, token: new Secret("grant-token") };
		await provider.setPosition(
			access,
			"2",
			RESUME_POSITION_MS,
			INITIAL_POSITION_MS,
		);
		await provider.setPosition(
			access,
			"2",
			RESUME_POSITION_MS,
			INITIAL_POSITION_MS,
		);
		expect(writes).toEqual([
			{
				token: "grant-token",
				query: {
					key: "2",
					identifier: "com.plexapp.plugins.library",
					time: "754000",
					state: "stopped",
				},
			},
		]);
	});

	it("skips a write within 5 seconds of the current offset", async () => {
		const cases: Array<[number | undefined, number, number]> = [
			[749_000, RESUME_POSITION_MS, 0],
			[759_000, RESUME_POSITION_MS, 0],
			[748_999, RESUME_POSITION_MS, 1],
			[759_001, RESUME_POSITION_MS, 1],
			[undefined, 5_000, 0],
			[undefined, 5_001, 1],
		];
		for (const [currentOffset, target, expectedWrites] of cases) {
			let writes = 0;
			const baseUrl = serve((request) => {
				const url = new URL(request.url);
				if (url.pathname === "/plex/library/metadata/2")
					return json({
						MediaContainer: {
							Metadata: [
								{
									ratingKey: "2",
									...(currentOffset === undefined
										? {}
										: { viewOffset: currentOffset }),
								},
							],
						},
					});
				if (url.pathname === "/plex/:/progress" && request.method === "PUT") {
					writes++;
					return new Response(null, { status: 200 });
				}
				return json({}, 404);
			});
			const provider = createPlexProvider({
				clientIdentifier: PLEX_IDENTIFIER,
			});
			await provider.setPosition(
				{ url: `${baseUrl}/plex`, token: new Secret("grant-token") },
				"2",
				target,
				currentOffset ?? null,
			);
			expect({ currentOffset, target, writes }).toEqual({
				currentOffset,
				target,
				writes: expectedWrites,
			});
		}
	});

	it("skips a stale write after playback moves past the scanned position", async () => {
		let viewOffset = ADVANCED_POSITION_MS;
		let writes = 0;
		const baseUrl = serve((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/plex/library/metadata/2")
				return json({
					MediaContainer: { Metadata: [{ ratingKey: "2", viewOffset }] },
				});
			if (url.pathname === "/plex/:/progress" && request.method === "PUT") {
				writes++;
				return new Response(null, { status: 200 });
			}
			return json({}, 404);
		});
		const provider = createPlexProvider({ clientIdentifier: PLEX_IDENTIFIER });
		const access = { url: `${baseUrl}/plex`, token: new Secret("grant-token") };
		const write = () =>
			provider.setPosition(
				access,
				"2",
				PLANNED_POSITION_MS,
				SCANNED_POSITION_MS,
			);
		expect({ result: await write(), writes }).toEqual({
			result: "stale",
			writes: 0,
		});
		viewOffset = SCANNED_POSITION_MS;
		expect({ result: await write(), writes }).toEqual({
			result: "applied",
			writes: 1,
		});
	});

	it("rejects an invalid item ID or position before any request", async () => {
		let requests = 0;
		const baseUrl = serve(() => {
			requests++;
			return json({}, 404);
		});
		const provider = createPlexProvider({ clientIdentifier: PLEX_IDENTIFIER });
		const access = { url: `${baseUrl}/plex`, token: new Secret("grant-token") };
		for (const itemId of ["../2", "2?time=0", ""])
			await expect(
				provider.setPosition(access, itemId, RESUME_POSITION_MS, null),
			).rejects.toThrow("Invalid Plex item ID.");
		for (const positionMs of [0, -1, 1.5])
			await expect(
				provider.setPosition(access, "2", positionMs, null),
			).rejects.toThrow("Invalid Plex resume position.");
		expect(requests).toBe(0);
	});

	it("sends an undated scrobble when markWatched receives playedAt", async () => {
		const scrobbles: Array<Record<string, string>> = [];
		const baseUrl = serve((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/plex/library/metadata/1")
				return json({
					MediaContainer: { Metadata: [{ ratingKey: "1", viewCount: 0 }] },
				});
			if (url.pathname === "/plex/:/scrobble" && request.method === "PUT") {
				scrobbles.push(Object.fromEntries(url.searchParams));
				return new Response(null, { status: 200 });
			}
			return json({}, 404);
		});
		const provider = createPlexProvider({ clientIdentifier: PLEX_IDENTIFIER });
		await provider.markWatched(
			{ url: `${baseUrl}/plex`, token: new Secret("grant-token") },
			"1",
			{ replaces: null, playedAt: Date.UTC(2026, 8, 1, 20) },
		);
		expect(scrobbles).toEqual([
			{ key: "1", identifier: "com.plexapp.plugins.library" },
		]);
	});

	it("restores resumeAt after the scrobble clears the position", async () => {
		const requests: string[] = [];
		const baseUrl = serve((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/plex/library/metadata/1")
				return json({
					MediaContainer: { Metadata: [{ ratingKey: "1", viewCount: 0 }] },
				});
			if (request.method === "PUT") {
				requests.push(`${url.pathname} ${url.searchParams.get("time") ?? ""}`);
				return new Response(null, { status: 200 });
			}
			return json({}, 404);
		});
		const provider = createPlexProvider({ clientIdentifier: PLEX_IDENTIFIER });
		await provider.markWatched(
			{ url: `${baseUrl}/plex`, token: new Secret("grant-token") },
			"1",
			{ replaces: null, resumeAt: RESUME_POSITION_MS },
		);
		expect(requests).toEqual(["/plex/:/scrobble ", "/plex/:/progress 754000"]);
	});

	it("skips marking watched after playback moves past the scanned position", async () => {
		let viewOffset = ADVANCED_POSITION_MS;
		const requests: string[] = [];
		const baseUrl = serve((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/plex/library/metadata/1")
				return json({
					MediaContainer: {
						Metadata: [{ ratingKey: "1", viewCount: 0, viewOffset }],
					},
				});
			if (request.method === "PUT") {
				requests.push(url.pathname);
				return new Response(null, { status: 200 });
			}
			return json({}, 404);
		});
		const provider = createPlexProvider({ clientIdentifier: PLEX_IDENTIFIER });
		const mark = () =>
			provider.markWatched(
				{ url: `${baseUrl}/plex`, token: new Secret("grant-token") },
				"1",
				{ replaces: SCANNED_POSITION_MS, resumeAt: PLANNED_POSITION_MS },
			);
		expect({ result: await mark(), requests }).toEqual({
			result: "stale",
			requests: [],
		});
		viewOffset = SCANNED_POSITION_MS;
		expect({ result: await mark(), requests }).toEqual({
			result: "applied",
			requests: ["/plex/:/scrobble", "/plex/:/progress"],
		});
	});

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
		await provider.markWatched(access, "1", { replaces: null });
		await provider.markWatched(access, "1", { replaces: null });
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
		).rejects.toThrow("redirected this request");
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
		await expect(
			provider.directory({
				token: new Secret("owner"),
				owner: { userId: "1", name: "Owner" },
				serverId: "owned",
			}),
		).rejects.toThrow();
	});
});

describe("Jellyfin provider", () => {
	it("sends datePlayed only when markWatched receives playedAt", async () => {
		const PLAYED_AT_MS = Date.UTC(2026, 8, 1, 20);
		const queries: Array<Record<string, string>> = [];
		const baseUrl = serve((request) => {
			const url = new URL(request.url);
			if (url.pathname.startsWith("/jf/Users/user-1/Items/")) {
				const id = url.pathname.split("/").at(-1);
				return json({
					Id: id,
					UserData: {
						Played: false,
						LastPlayedDate: null,
						PlayCount: 0,
						IsFavorite: false,
						Key: `key-${id}`,
						ItemId: id,
						PlaybackPositionTicks: 0,
					},
				});
			}
			if (
				url.pathname.startsWith("/jf/Users/user-1/PlayedItems/") &&
				request.method === "POST"
			) {
				queries.push(Object.fromEntries(url.searchParams));
				return new Response(null, { status: 204 });
			}
			return json({}, 404);
		});
		const provider = createJellyfinProvider({
			clientIdentifier: JELLYFIN_IDENTIFIER,
		});
		const access = {
			url: `${baseUrl}/jf`,
			userId: "user-1",
			token: new Secret("user-token"),
		};
		await provider.markWatched(access, "item-1", {
			replaces: null,
			playedAt: PLAYED_AT_MS,
		});
		await provider.markWatched(access, "item-2", { replaces: null });
		expect(queries).toEqual([{ datePlayed: "2026-09-01T20:00:00.000Z" }, {}]);
	});

	it("restores resumeAt from the marked state after PlayedItems clears the position", async () => {
		let userData = {
			Played: false,
			LastPlayedDate: "2026-09-01T20:00:00.0000000Z",
			PlayCount: 0,
			IsFavorite: false,
			Key: "key-item-1",
			ItemId: "item-1",
			PlaybackPositionTicks: RESUME_POSITION_MS * TICKS_PER_MILLISECOND,
		};
		const posts: unknown[] = [];
		const baseUrl = serve(async (request) => {
			const url = new URL(request.url);
			if (url.pathname === "/jf/Users/user-1/Items/item-1")
				return json({ Id: "item-1", UserData: userData });
			if (
				url.pathname === "/jf/Users/user-1/PlayedItems/item-1" &&
				request.method === "POST"
			) {
				posts.push("PlayedItems");
				userData = {
					...userData,
					Played: true,
					PlayCount: 1,
					PlaybackPositionTicks: 0,
				};
				return new Response(null, { status: 204 });
			}
			if (
				url.pathname === "/jf/Users/user-1/Items/item-1/UserData" &&
				request.method === "POST"
			) {
				posts.push(await request.json());
				return new Response(null, { status: 200 });
			}
			return json({}, 404);
		});
		const provider = createJellyfinProvider({
			clientIdentifier: JELLYFIN_IDENTIFIER,
		});
		await provider.markWatched(
			{
				url: `${baseUrl}/jf`,
				userId: "user-1",
				token: new Secret("user-token"),
			},
			"item-1",
			{ replaces: RESUME_POSITION_MS, resumeAt: RESUME_POSITION_MS },
		);
		expect(posts).toEqual([
			"PlayedItems",
			{
				Played: true,
				LastPlayedDate: "2026-09-01T20:00:00.0000000Z",
				PlayCount: 1,
				IsFavorite: false,
				Key: "key-item-1",
				ItemId: "item-1",
				PlaybackPositionTicks: 7_540_000_000,
			},
		]);
	});

	it("skips marking watched after playback moves past the scanned position, even when already played", async () => {
		const userData = {
			Played: false,
			LastPlayedDate: "2026-09-01T20:00:00.0000000Z",
			PlayCount: 0,
			IsFavorite: false,
			Key: "key-item-1",
			ItemId: "item-1",
			PlaybackPositionTicks: ADVANCED_POSITION_MS * TICKS_PER_MILLISECOND,
		};
		const posts: string[] = [];
		const baseUrl = serve((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/jf/Users/user-1/Items/item-1")
				return json({ Id: "item-1", UserData: userData });
			if (request.method === "POST") {
				posts.push(url.pathname);
				return new Response(null, { status: 204 });
			}
			return json({}, 404);
		});
		const provider = createJellyfinProvider({
			clientIdentifier: JELLYFIN_IDENTIFIER,
		});
		const mark = () =>
			provider.markWatched(
				{
					url: `${baseUrl}/jf`,
					userId: "user-1",
					token: new Secret("user-token"),
				},
				"item-1",
				{ replaces: SCANNED_POSITION_MS, resumeAt: PLANNED_POSITION_MS },
			);
		expect({ result: await mark(), posts }).toEqual({
			result: "stale",
			posts: [],
		});
		userData.Played = true;
		expect({ result: await mark(), posts }).toEqual({
			result: "stale",
			posts: [],
		});
		userData.PlaybackPositionTicks =
			SCANNED_POSITION_MS * TICKS_PER_MILLISECOND;
		expect({ result: await mark(), posts }).toEqual({
			result: "applied",
			posts: ["/jf/Users/user-1/Items/item-1/UserData"],
		});
	});

	it("never sends a played date earlier than the item's current one", async () => {
		const SCANNED_DATE = "2026-10-01T10:00:00.000Z";
		const PLANNED_DATE_MS = Date.parse("2026-10-02T10:00:00.000Z");
		const NEWER_DATE = "2026-10-03T10:00:00.000Z";
		let lastPlayedDate = NEWER_DATE;
		const queries: Array<Record<string, string>> = [];
		const baseUrl = serve((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/jf/Users/user-1/Items/item-1")
				return json({
					Id: "item-1",
					UserData: {
						Played: false,
						LastPlayedDate: lastPlayedDate,
						PlaybackPositionTicks: 0,
					},
				});
			if (request.method === "POST") {
				queries.push(Object.fromEntries(url.searchParams));
				return new Response(null, { status: 204 });
			}
			return json({}, 404);
		});
		const provider = createJellyfinProvider({
			clientIdentifier: JELLYFIN_IDENTIFIER,
		});
		const mark = () =>
			provider.markWatched(
				{
					url: `${baseUrl}/jf`,
					userId: "user-1",
					token: new Secret("user-token"),
				},
				"item-1",
				{ replaces: null, playedAt: PLANNED_DATE_MS },
			);
		await mark();
		lastPlayedDate = SCANNED_DATE;
		await mark();
		expect(queries).toEqual([{}, { datePlayed: "2026-10-02T10:00:00.000Z" }]);
	});

	it("writes UserData with only the position replaced and skips the identical repeat", async () => {
		const INITIAL_POSITION_TICKS = 1_000_000_000;
		const userData = {
			Played: true,
			LastPlayedDate: "2026-09-01T20:00:00.0000000Z",
			PlayCount: 1,
			IsFavorite: false,
			Key: "key-item-1",
			ItemId: "item-1",
			PlaybackPositionTicks: INITIAL_POSITION_TICKS,
		};
		const writes: unknown[] = [];
		const baseUrl = serve(async (request) => {
			const url = new URL(request.url);
			if (url.pathname === "/jf/Users/user-1/Items/item-1")
				return json({ Id: "item-1", UserData: userData });
			if (
				url.pathname === "/jf/Users/user-1/Items/item-1/UserData" &&
				request.method === "POST"
			) {
				const body: unknown = await request.json();
				writes.push(body);
				userData.PlaybackPositionTicks = z
					.object({ PlaybackPositionTicks: z.number() })
					.parse(body).PlaybackPositionTicks;
				return new Response(null, { status: 200 });
			}
			return json({}, 404);
		});
		const provider = createJellyfinProvider({
			clientIdentifier: JELLYFIN_IDENTIFIER,
		});
		const access = {
			url: `${baseUrl}/jf`,
			userId: "user-1",
			token: new Secret("user-token"),
		};
		const initialPositionMs = INITIAL_POSITION_TICKS / TICKS_PER_MILLISECOND;
		await provider.setPosition(
			access,
			"item-1",
			RESUME_POSITION_MS,
			initialPositionMs,
		);
		await provider.setPosition(
			access,
			"item-1",
			RESUME_POSITION_MS,
			initialPositionMs,
		);
		expect(writes).toEqual([
			{
				Played: true,
				LastPlayedDate: "2026-09-01T20:00:00.0000000Z",
				PlayCount: 1,
				IsFavorite: false,
				Key: "key-item-1",
				ItemId: "item-1",
				PlaybackPositionTicks: 7_540_000_000,
			},
		]);
	});

	it("skips a write within 5 seconds of the current position", async () => {
		const cases: Array<[number, number, number]> = [
			[7_490_000_000, RESUME_POSITION_MS, 0],
			[7_590_000_000, RESUME_POSITION_MS, 0],
			[7_489_990_000, RESUME_POSITION_MS, 1],
			[7_590_010_000, RESUME_POSITION_MS, 1],
			[0, 5_000, 0],
			[0, 5_001, 1],
		];
		for (const [currentTicks, target, expectedWrites] of cases) {
			let writes = 0;
			const baseUrl = serve((request) => {
				const url = new URL(request.url);
				if (url.pathname === "/jf/Users/user-1/Items/item-1")
					return json({
						Id: "item-1",
						UserData: {
							Played: true,
							LastPlayedDate: "2026-09-01T20:00:00.0000000Z",
							PlayCount: 1,
							IsFavorite: false,
							Key: "key-item-1",
							ItemId: "item-1",
							PlaybackPositionTicks: currentTicks,
						},
					});
				if (
					url.pathname === "/jf/Users/user-1/Items/item-1/UserData" &&
					request.method === "POST"
				) {
					writes++;
					return new Response(null, { status: 200 });
				}
				return json({}, 404);
			});
			const provider = createJellyfinProvider({
				clientIdentifier: JELLYFIN_IDENTIFIER,
			});
			await provider.setPosition(
				{
					url: `${baseUrl}/jf`,
					userId: "user-1",
					token: new Secret("user-token"),
				},
				"item-1",
				target,
				currentTicks / TICKS_PER_MILLISECOND,
			);
			expect({ currentTicks, target, writes }).toEqual({
				currentTicks,
				target,
				writes: expectedWrites,
			});
		}
	});

	it("skips a stale write after playback moves past the scanned position", async () => {
		let positionTicks = ADVANCED_POSITION_MS * TICKS_PER_MILLISECOND;
		let writes = 0;
		const baseUrl = serve((request) => {
			const url = new URL(request.url);
			if (url.pathname === "/jf/Users/user-1/Items/item-1")
				return json({
					Id: "item-1",
					UserData: {
						Played: false,
						LastPlayedDate: "2026-09-01T20:00:00.0000000Z",
						PlayCount: 0,
						IsFavorite: false,
						Key: "key-item-1",
						ItemId: "item-1",
						PlaybackPositionTicks: positionTicks,
					},
				});
			if (
				url.pathname === "/jf/Users/user-1/Items/item-1/UserData" &&
				request.method === "POST"
			) {
				writes++;
				return new Response(null, { status: 200 });
			}
			return json({}, 404);
		});
		const provider = createJellyfinProvider({
			clientIdentifier: JELLYFIN_IDENTIFIER,
		});
		const access = {
			url: `${baseUrl}/jf`,
			userId: "user-1",
			token: new Secret("user-token"),
		};
		const write = () =>
			provider.setPosition(
				access,
				"item-1",
				PLANNED_POSITION_MS,
				SCANNED_POSITION_MS,
			);
		expect({ result: await write(), writes }).toEqual({
			result: "stale",
			writes: 0,
		});
		positionTicks = SCANNED_POSITION_MS * TICKS_PER_MILLISECOND;
		expect({ result: await write(), writes }).toEqual({
			result: "applied",
			writes: 1,
		});
	});

	it("rejects an invalid position or played date before any request", async () => {
		const LATEST_DATE_MS = 8_640_000_000_000_000;
		let requests = 0;
		const baseUrl = serve(() => {
			requests++;
			return json({}, 404);
		});
		const provider = createJellyfinProvider({
			clientIdentifier: JELLYFIN_IDENTIFIER,
		});
		const access = {
			url: `${baseUrl}/jf`,
			userId: "user-1",
			token: new Secret("user-token"),
		};
		for (const positionMs of [0, -1, 1.5])
			await expect(
				provider.setPosition(access, "item-1", positionMs, null),
			).rejects.toThrow("Invalid Jellyfin resume position.");
		for (const playedAt of [
			Number.NaN,
			Number.POSITIVE_INFINITY,
			LATEST_DATE_MS + 1,
		])
			await expect(
				provider.markWatched(access, "item-1", { replaces: null, playedAt }),
			).rejects.toThrow("Invalid Jellyfin played date.");
		expect(requests).toBe(0);
	});

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
			history: { lastPlayedAt: null, positionMs: null },
		});
		expect(starts).toEqual([0, PAGE_SIZE]);
		await provider.markWatched(access, "item-1", { replaces: null });
		await provider.markWatched(access, "item-1", { replaces: null });
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
		{
			id: "1",
			kind: "episode",
			title: "Pilot",
			ids: [],
			watched: false,
			history: { lastPlayedAt: null, positionMs: null },
			episode: {
				series: { localId: null, providerIds: {} },
				numbering: { kind: "unnumbered" },
			},
		},
		{
			id: "2",
			kind: "episode",
			title: "Second",
			ids: [{ provider: "tvdb", value: "349232" }],
			watched: false,
			history: { lastPlayedAt: null, positionMs: null },
			episode: {
				series: { localId: null, providerIds: {} },
				numbering: { kind: "unnumbered" },
			},
		},
	]);
});

describe("library display details", () => {
	it("reads Plex episode hierarchy and every media part path", async () => {
		const url = serve((request) => {
			const path = new URL(request.url).pathname;
			if (path === "/library/metadata/7")
				return json({ MediaContainer: { Metadata: [{ ratingKey: "7" }] } });
			return path === "/library/sections"
				? json({ MediaContainer: { Directory: [{ key: "2", type: "show" }] } })
				: json({
						MediaContainer: {
							totalSize: 1,
							Metadata: [
								{
									ratingKey: "12",
									title: "Pilot",
									grandparentRatingKey: "7",
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
					});
		});
		const items = await createPlexProvider({
			clientIdentifier: PLEX_IDENTIFIER,
		}).items({ url, token: new Secret("token") });
		expect(items[0].details).toEqual({
			paths: ["/tv/pilot-a.mkv", "/tv/pilot-b.mkv"],
			showTitle: "Example",
			season: 0,
			episode: 1,
		});
		expect(episodeIdentity(items[0])).toEqual({
			series: { localId: "7", providerIds: {} },
			numbering: { kind: "special", episodes: { first: 1, count: 1 } },
		});
	});
	it("requests Jellyfin paths and reads episode hierarchy without inventing missing metadata", async () => {
		const url = serve((request) => {
			const params = new URL(request.url).searchParams;
			if (params.get("Ids") === "series-7")
				return json({ Items: [{ Id: "series-7" }], TotalRecordCount: 1 });
			expect(params.get("Fields")).toBe("ProviderIds,Path");
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
			showTitle: "Example",
			season: 0,
			episode: 1,
		});
		expect(episodeIdentity(items[0])?.series.localId).toBe("series-7");
		expect(episodeIdentity(items[1])?.series.localId).toBeNull();
		expect(items[1].details?.paths).toBeUndefined();
		expect(items[1].details?.season).toBeUndefined();
		expect(items[1].ids).toEqual([]);
	});
});

describe("series identity", () => {
	it("attaches Plex show GUIDs and numbering with one read per show", async () => {
		const showReads: string[] = [];
		const sharedFile = [{ Part: [{ file: "/tv/other/s02e03-e04.mkv" }] }];
		const library = [
			...Array.from({ length: PAGE_SIZE + 1 }, (_, index) => ({
				ratingKey: String(index + 1),
				grandparentRatingKey: "7",
				parentIndex: 1,
				index: index + 1,
				Media: [{ Part: [{ file: `/tv/show/${index + 1}.mkv` }] }],
			})),
			{
				ratingKey: "201",
				grandparentRatingKey: "8",
				parentIndex: 2,
				index: 3,
				Media: sharedFile,
			},
			{
				ratingKey: "202",
				grandparentRatingKey: "8",
				parentIndex: 2,
				index: 4,
				Media: sharedFile,
			},
		];
		const url = serve((request) => {
			const path = new URL(request.url).pathname;
			if (path === "/library/sections")
				return json({
					MediaContainer: { Directory: [{ key: "1", type: "show" }] },
				});
			if (path === "/library/sections/1/all") {
				const offset = Number(request.headers.get("X-Plex-Container-Start"));
				return json({
					MediaContainer: {
						totalSize: library.length,
						offset,
						Metadata: library.slice(offset, offset + PAGE_SIZE),
					},
				});
			}
			const showKey = path.split("/").at(-1) ?? "";
			showReads.push(showKey);
			return json({
				MediaContainer: {
					Metadata: [
						showKey === "7"
							? {
									ratingKey: "7",
									Guid: [{ id: "tvdb://81189" }, { id: "imdb://tt0903747" }],
								}
							: { ratingKey: showKey },
					],
				},
			});
		});
		const items = await createPlexProvider({
			clientIdentifier: PLEX_IDENTIFIER,
		}).items({ url, token: new Secret("token") });
		expect(showReads).toEqual(["7", "8"]);
		expect(episodeIdentity(items[PAGE_SIZE])).toEqual({
			series: {
				localId: "7",
				providerIds: { tvdb: "81189", imdb: "tt0903747" },
			},
			numbering: {
				kind: "season",
				season: 1,
				episodes: { first: PAGE_SIZE + 1, count: 1 },
			},
		});
		const multiEpisode: ReturnType<typeof episodeIdentity> = {
			series: { localId: "8", providerIds: {} },
			numbering: {
				kind: "season",
				season: 2,
				episodes: { first: 3, count: 2 },
			},
		};
		expect(items.slice(-2).map(episodeIdentity)).toEqual([
			multiEpisode,
			multiEpisode,
		]);
	});

	it("attaches Jellyfin series provider IDs and numbering with one read per series", async () => {
		const seriesReads: string[] = [];
		const episode = (
			id: string,
			seriesId: string,
			season: number | null,
			first: number,
			last?: number,
		) => ({
			Id: id,
			Type: "Episode",
			SeriesId: seriesId,
			ParentIndexNumber: season,
			IndexNumber: first,
			IndexNumberEnd: last,
			UserData: { Played: false },
		});
		const library = [
			...Array.from({ length: PAGE_SIZE + 1 }, (_, index) =>
				episode(`e${index + 1}`, "s1", 1, index + 1),
			),
			episode("multi", "s2", 2, 3, 4),
			episode("special", "s2", 0, 1),
			episode("absolute", "s2", null, 147),
		];
		const url = serve((request) => {
			const params = new URL(request.url).searchParams;
			const ids = params.get("Ids");
			if (ids === null) {
				const offset = Number(params.get("StartIndex"));
				return json({
					Items: library.slice(offset, offset + PAGE_SIZE),
					TotalRecordCount: library.length,
				});
			}
			seriesReads.push(`${ids}:${params.get("Fields")}`);
			return json({
				Items: [
					ids === "s1"
						? {
								Id: "s1",
								ProviderIds: { Tvdb: "81189", Imdb: "tt0903747", Tmdb: "" },
							}
						: { Id: ids, ProviderIds: {} },
				],
				TotalRecordCount: 1,
			});
		});
		const items = await createJellyfinProvider({
			clientIdentifier: JELLYFIN_IDENTIFIER,
		}).items({ url, userId: "person", token: new Secret("token") });
		expect(seriesReads).toEqual(["s1:ProviderIds", "s2:ProviderIds"]);
		expect(episodeIdentity(items[0])).toEqual({
			series: {
				localId: "s1",
				providerIds: { tvdb: "81189", imdb: "tt0903747" },
			},
			numbering: {
				kind: "season",
				season: 1,
				episodes: { first: 1, count: 1 },
			},
		});
		expect(items.slice(-3).map(episodeIdentity)).toEqual([
			{
				series: { localId: "s2", providerIds: {} },
				numbering: {
					kind: "season",
					season: 2,
					episodes: { first: 3, count: 2 },
				},
			},
			{
				series: { localId: "s2", providerIds: {} },
				numbering: { kind: "special", episodes: { first: 1, count: 1 } },
			},
			{
				series: { localId: "s2", providerIds: {} },
				numbering: { kind: "absolute", episodes: { first: 147, count: 1 } },
			},
		]);
	});
});

describe("watch history", () => {
	it("reads Plex last viewed time and resume position", async () => {
		const url = serve((request) =>
			new URL(request.url).pathname === "/library/sections"
				? json({ MediaContainer: { Directory: [{ key: "1", type: "movie" }] } })
				: json({
						MediaContainer: {
							totalSize: 3,
							Metadata: [
								{
									ratingKey: "1",
									lastViewedAt: 1_700_000_000,
									viewOffset: 754_000,
								},
								{ ratingKey: "2", lastViewedAt: 1_700_000_001, viewOffset: 0 },
								{ ratingKey: "3" },
							],
						},
					}),
		);
		const items = await createPlexProvider({
			clientIdentifier: PLEX_IDENTIFIER,
		}).items({ url, token: new Secret("token") });
		expect(items.map((item) => item.history)).toEqual([
			{ lastPlayedAt: 1_700_000_000_000, positionMs: 754_000 },
			{ lastPlayedAt: 1_700_000_001_000, positionMs: null },
			{ lastPlayedAt: null, positionMs: null },
		]);
	});

	it("reads Jellyfin last played date and resume position", async () => {
		const url = serve(() =>
			json({
				TotalRecordCount: 3,
				Items: [
					{
						Id: "j1",
						Type: "Movie",
						UserData: {
							Played: false,
							LastPlayedDate: "2023-11-14T22:13:20.1234567Z",
							PlaybackPositionTicks: 7_540_000_000,
						},
					},
					{
						Id: "j2",
						Type: "Movie",
						UserData: {
							Played: true,
							LastPlayedDate: "2023-11-14T22:13:21Z",
							PlaybackPositionTicks: 0,
						},
					},
					{ Id: "j3", Type: "Movie", UserData: { Played: false } },
				],
			}),
		);
		const items = await createJellyfinProvider({
			clientIdentifier: JELLYFIN_IDENTIFIER,
		}).items({ url, userId: "person", token: new Secret("token") });
		expect(items.map((item) => item.history)).toEqual([
			{ lastPlayedAt: 1_700_000_000_123, positionMs: 754_000 },
			{ lastPlayedAt: 1_700_000_001_000, positionMs: null },
			{ lastPlayedAt: null, positionMs: null },
		]);
	});
});
