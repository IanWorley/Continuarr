import { migrate } from "drizzle-orm/node-postgres/migrator";
import { GenericContainer, Wait } from "testcontainers";
import { z } from "zod";
import {
	MILLISECONDS_PER_MINUTE,
	MILLISECONDS_PER_SECOND,
} from "../src/backend/media/constants";
import { TICKS_PER_MILLISECOND } from "../src/backend/media/jellyfin";
import {
	CREDENTIAL_KEY_BYTES,
	createSecretStorage,
	Secret,
} from "../src/backend/secrets/storage";
import { createDatabase } from "../src/db/database";
import * as schema from "../src/db/schema";

const DEFAULT_FIXTURE_PORT = 43123;
const FIXTURE_PORT = z.coerce
	.number()
	.int()
	.min(1)
	.max(65535)
	.parse(process.env.FIXTURE_PORT ?? DEFAULT_FIXTURE_PORT);
const FIXTURE_KEY_BYTE = 7;
const KEY = Buffer.alloc(CREDENTIAL_KEY_BYTES, FIXTURE_KEY_BYTE).toString(
	"base64",
);
const POSTGRES_PORT = 5432;
const POSTGRES_IMAGE = "postgres:17.6-alpine";
const POSTGRES_READY_LOG_OCCURRENCES = 2;
const container = await new GenericContainer(POSTGRES_IMAGE)
	.withEnvironment({
		POSTGRES_USER: "continuarr",
		POSTGRES_PASSWORD: "fixture-password",
		POSTGRES_DB: "continuarr",
	})
	.withExposedPorts(POSTGRES_PORT)
	.withWaitStrategy(
		Wait.forLogMessage(
			"database system is ready to accept connections",
			POSTGRES_READY_LOG_OCCURRENCES,
		),
	)
	.start();
const databaseUrl = `postgresql://continuarr:fixture-password@${container.getHost()}:${container.getMappedPort(POSTGRES_PORT)}/continuarr`;
const { client, db } = createDatabase(databaseUrl);
await migrate(db, { migrationsFolder: "./drizzle/postgres" });
const secrets = createSecretStorage(KEY);
const base = `http://127.0.0.1:${FIXTURE_PORT}`;
await db.insert(schema.plexAccounts).values({
	id: "fixture-account",
	userId: "42",
	name: "Fixture parent",
	token: secrets.encrypt(
		"fixture-account",
		new Secret("fixture-account-token"),
	),
});
await db.insert(schema.plexProfiles).values({
	id: "fixture-plex",
	accountId: "fixture-account",
	userId: "43",
	name: "Alex (Home)",
	serverId: "fixture-plex-server",
	serverName: "Fixture Plex",
	url: `${base}/plex`,
	token: secrets.encrypt("fixture-plex", new Secret("fixture-plex-token")),
});
await client.end();
const plexWatched = new Set(["1", "3", "6"]);
const jellyfinWatched = new Set(["j2"]);
const LAST_PLAYED_AT_MS = Date.UTC(2026, 8, 1, 20);
const MINUTES_PER_DAY = 24 * 60;
const MILLISECONDS_PER_DAY = MINUTES_PER_DAY * MILLISECONDS_PER_MINUTE;
const DAYS_PER_WEEK = 7;
const WEEK_BEFORE_MS = LAST_PLAYED_AT_MS - DAYS_PER_WEEK * MILLISECONDS_PER_DAY;
const DAY_AFTER_MS = LAST_PLAYED_AT_MS + MILLISECONDS_PER_DAY;
// Only Alex reports activity, so the Users page covers both a real date and "Never".
const ALEX_LAST_ACTIVE_AT = new Date(Date.UTC(2026, 8, 2, 18)).toISOString();
const RESUME_POSITION_MS = 754_000;
const LATER_RESUME_POSITION_MS = 1_234_000;
const CONFLICTING_RESUME_POSITION_MS = 600_000;
// The Martian was played last on Plex and Polar night on Jellyfin, so each
// position copies to the other server. Aurora was played at the same time on
// both, so its positions conflict.
const plexLastPlayedAt = new Map(
	["1", "2", "3", "6", "7"].map((id) => [id, LAST_PLAYED_AT_MS]),
);
const jellyfinLastPlayedAt = new Map([
	["j2", WEEK_BEFORE_MS],
	["j4", LAST_PLAYED_AT_MS],
	["j6", LAST_PLAYED_AT_MS],
	["j7", DAY_AFTER_MS],
]);
const plexPositions = new Map([["2", RESUME_POSITION_MS]]);
const jellyfinPositions = new Map([
	["j4", RESUME_POSITION_MS],
	["j6", CONFLICTING_RESUME_POSITION_MS],
	["j7", LATER_RESUME_POSITION_MS],
]);
const jellyfinPlayedDates = new Map<string, string>();
const titles = [
	"Arrival",
	"The Martian",
	"First contact",
	"Return",
	"New horizons",
	"Aurora",
	"Polar night",
	"Behind the lights",
];
const ids = ["329865", "286217"];
const MOVIE_COUNT = 2;
// Expedition has no series ID, so its episodes need a manual match.
// Northern Lights shares a TVDb series ID, so its regular episodes match by number.
const EXPEDITION = {
	plexKey: "100",
	jellyfinId: "series-1",
	title: "Expedition",
	tvdb: null,
};
const NORTHERN_LIGHTS = {
	plexKey: "101",
	jellyfinId: "series-2",
	title: "Northern Lights",
	tvdb: "389204",
};
const SHOWS = [EXPEDITION, NORTHERN_LIGHTS];
const EPISODES = [
	{ show: EXPEDITION, season: 1, episode: 1 },
	{ show: EXPEDITION, season: 1, episode: 2 },
	{ show: EXPEDITION, season: 2, episode: 1 },
	{ show: NORTHERN_LIGHTS, season: 1, episode: 1 },
	{ show: NORTHERN_LIGHTS, season: 1, episode: 2 },
	{ show: NORTHERN_LIGHTS, season: 0, episode: 1 },
];
function plexItem(index: number) {
	const id = String(index + 1);
	const viewOffset = plexPositions.get(id);
	const lastPlayedAt = plexLastPlayedAt.get(id);
	const episode = EPISODES[index - MOVIE_COUNT];
	return {
		ratingKey: id,
		type: episode ? "episode" : "movie",
		Media: [
			{
				Part: [
					{
						file: `/media/${episode ? `tv/${episode.show.title}` : "movies"}/${titles[index]}.mkv`,
					},
				],
			},
		],
		...(episode
			? {
					grandparentRatingKey: episode.show.plexKey,
					grandparentTitle: episode.show.title,
					parentIndex: episode.season,
					index: episode.episode,
				}
			: {}),
		title: titles[index],
		Guid: ids[index] ? [{ id: `tmdb://${ids[index]}` }] : [],
		...(plexWatched.has(id) ? { viewCount: 1 } : {}),
		...(lastPlayedAt === undefined
			? {}
			: { lastViewedAt: lastPlayedAt / MILLISECONDS_PER_SECOND }),
		...(viewOffset === undefined ? {} : { viewOffset }),
	};
}
function plexShow(show: (typeof SHOWS)[number]) {
	return {
		ratingKey: show.plexKey,
		title: show.title,
		Guid: show.tvdb ? [{ id: `tvdb://${show.tvdb}` }] : [],
	};
}
function jellyfinItem(index: number) {
	const id = `j${index + 1}`;
	const episode = EPISODES[index - MOVIE_COUNT];
	const positionMs = jellyfinPositions.get(id);
	const lastPlayedAt = jellyfinLastPlayedAt.get(id);
	const lastPlayedDate =
		jellyfinPlayedDates.get(id) ??
		(lastPlayedAt === undefined
			? undefined
			: new Date(lastPlayedAt).toISOString());
	return {
		Id: id,
		Name: titles[index],
		Type: episode ? "Episode" : "Movie",
		Path: `/data/${episode ? `shows/${episode.show.title}` : "movies"}/${titles[index]}.mkv`,
		...(episode
			? {
					SeriesId: episode.show.jellyfinId,
					SeriesName: episode.show.title,
					ParentIndexNumber: episode.season,
					IndexNumber: episode.episode,
				}
			: {}),
		ProviderIds: ids[index] ? { Tmdb: ids[index] } : {},
		UserData: {
			Played: jellyfinWatched.has(id),
			...(lastPlayedDate === undefined
				? {}
				: { LastPlayedDate: lastPlayedDate }),
			...(positionMs === undefined
				? {}
				: { PlaybackPositionTicks: positionMs * TICKS_PER_MILLISECOND }),
		},
	};
}
/** Plex reports last-viewed times in whole seconds. */
function plexNow(): number {
	return (
		Math.floor(Date.now() / MILLISECONDS_PER_SECOND) * MILLISECONDS_PER_SECOND
	);
}
const fixtureControlSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("fail-next-position-write"),
		service: z.enum(["plex", "jellyfin"]),
		id: z.string().min(1),
	}),
	z.object({
		action: z.literal("play-before-next-write"),
		service: z.enum(["plex", "jellyfin"]),
		id: z.string().min(1),
		positionMs: z.number().int().positive(),
	}),
]);
const failNextWrite = new Set<string>();
const playBeforeWrite = new Map<string, number>();
function takePlayback(key: string): number | undefined {
	const positionMs = playBeforeWrite.get(key);
	playBeforeWrite.delete(key);
	return positionMs;
}
const server = Bun.serve({
	port: FIXTURE_PORT,
	hostname: "127.0.0.1",
	async fetch(request) {
		const url = new URL(request.url);
		const path = url.pathname;
		if (path === "/fixture-control" && request.method === "POST") {
			const control = fixtureControlSchema.parse(await request.json());
			const key = `${control.service}:${control.id}`;
			if (control.action === "fail-next-position-write") failNextWrite.add(key);
			else playBeforeWrite.set(key, control.positionMs);
			return new Response(null, { status: 204 });
		}
		if (path === "/fixture-state")
			return Response.json({
				plex: [...plexWatched],
				plexPositions: Object.fromEntries(plexPositions),
				jellyfin: [...jellyfinWatched],
				jellyfinPositions: Object.fromEntries(jellyfinPositions),
				jellyfinPlayedDates: Object.fromEntries(jellyfinPlayedDates),
			});
		if (
			path.startsWith("/plex/") &&
			request.headers.get("x-plex-token") !== "fixture-plex-token"
		)
			return new Response(null, { status: 401 });
		if (path === "/plex/identity")
			return Response.json({
				MediaContainer: { machineIdentifier: "fixture-plex-server" },
			});
		if (path === "/plex/library/sections")
			return Response.json({
				MediaContainer: {
					Directory: [
						{ key: "1", type: "movie" },
						{ key: "2", type: "show" },
					],
				},
			});
		if (path === "/plex/library/sections/1/all")
			return Response.json({
				MediaContainer: {
					totalSize: 2,
					offset: 0,
					Metadata: [plexItem(0), plexItem(1)],
				},
			});
		if (path === "/plex/library/sections/2/all")
			return Response.json({
				MediaContainer: {
					totalSize: EPISODES.length,
					offset: 0,
					Metadata: EPISODES.map((_, index) => plexItem(MOVIE_COUNT + index)),
				},
			});
		if (path.startsWith("/plex/library/metadata/")) {
			const key = path.split("/").at(-1) ?? "";
			const played = takePlayback(`plex:${key}`);
			if (played !== undefined) {
				plexPositions.set(key, played);
				plexLastPlayedAt.set(key, plexNow());
			}
			const show = SHOWS.find(({ plexKey }) => plexKey === key);
			return Response.json({
				MediaContainer: {
					Metadata: [show ? plexShow(show) : plexItem(Number(key) - 1)],
				},
			});
		}
		if (path === "/plex/:/scrobble") {
			const key = url.searchParams.get("key") ?? "";
			plexWatched.add(key);
			// Like Plex, marking an item watched clears its resume position and records playback now.
			plexPositions.delete(key);
			plexLastPlayedAt.set(key, plexNow());
			return new Response(null, { status: 200 });
		}
		if (path === "/plex/:/progress") {
			const key = url.searchParams.get("key") ?? "";
			if (failNextWrite.delete(`plex:${key}`))
				return new Response(null, { status: 503 });
			plexPositions.set(key, Number(url.searchParams.get("time")));
			plexLastPlayedAt.set(key, plexNow());
			return new Response(null, { status: 200 });
		}
		if (path === "/jellyfin/System/Info")
			return Response.json({
				Id: "fixture-jellyfin-server",
				ServerName: "Fixture Jellyfin",
			});
		if (
			path.startsWith("/jellyfin/") &&
			!request.headers
				.get("authorization")
				?.endsWith(', Token="fixture-jellyfin-token"')
		)
			return new Response(null, { status: 401 });
		if (path === "/jellyfin/Users")
			return Response.json([
				{
					Id: "alex-id",
					Name: "Alex",
					LastActivityDate: ALEX_LAST_ACTIVE_AT,
					LastLoginDate: ALEX_LAST_ACTIVE_AT,
				},
				{ Id: "other-id", Name: "Other" },
			]);
		if (path === "/jellyfin/Users/other-id")
			return Response.json({ Id: "other-id", Name: "Other" });
		if (path === "/jellyfin/Users/other-id/Items")
			return Response.json({ Items: [], TotalRecordCount: 0 });
		if (path === "/jellyfin/Users/alex-id")
			return Response.json({ Id: "alex-id", Name: "Alex" });
		if (path === "/jellyfin/Users/alex-id/Items") {
			const seriesId = url.searchParams.get("Ids");
			const items = seriesId
				? SHOWS.filter(({ jellyfinId }) => jellyfinId === seriesId).map(
						(show) => ({
							Id: show.jellyfinId,
							Name: show.title,
							ProviderIds: show.tvdb ? { Tvdb: show.tvdb } : {},
						}),
					)
				: titles.map((_, index) => jellyfinItem(index));
			return Response.json({ Items: items, TotalRecordCount: items.length });
		}
		if (
			path.startsWith("/jellyfin/Users/alex-id/Items/") &&
			path.endsWith("/UserData") &&
			request.method === "POST"
		) {
			if (failNextWrite.delete(`jellyfin:${path.split("/").at(-2)}`))
				return new Response(null, { status: 503 });
			const body = z
				.object({ PlaybackPositionTicks: z.number().int().nonnegative() })
				.parse(await request.json());
			jellyfinPositions.set(
				path.split("/").at(-2) ?? "",
				body.PlaybackPositionTicks / TICKS_PER_MILLISECOND,
			);
			return new Response(null, { status: 200 });
		}
		if (path.startsWith("/jellyfin/Users/alex-id/Items/")) {
			const id = path.split("/").at(-1) ?? "";
			const played = takePlayback(`jellyfin:${id}`);
			if (played !== undefined) {
				jellyfinPositions.set(id, played);
				jellyfinLastPlayedAt.set(id, Date.now());
				jellyfinPlayedDates.delete(id);
			}
		}
		if (path.startsWith("/jellyfin/Users/alex-id/Items/"))
			return Response.json(
				jellyfinItem(Number(path.split("/").at(-1)?.slice(1)) - 1),
			);
		if (
			path.startsWith("/jellyfin/Users/alex-id/PlayedItems/") &&
			request.method === "POST"
		) {
			const id = path.split("/").at(-1) ?? "";
			jellyfinWatched.add(id);
			// Like Jellyfin, marking an item played clears its resume position.
			jellyfinPositions.delete(id);
			const datePlayed = url.searchParams.get("datePlayed");
			if (datePlayed !== null) jellyfinPlayedDates.set(id, datePlayed);
			return new Response(null, { status: 204 });
		}
		return new Response("Fixture endpoint not found", { status: 404 });
	},
});
console.log(
	`Fixture running at ${server.url}. Start the app in another terminal:\nDATABASE_URL=${databaseUrl} CREDENTIAL_ENCRYPTION_KEY=${KEY} bun run dev --host 127.0.0.1\nCreate a temporary Continuarr owner in the browser. Open Connections & sync and import Jellyfin at ${base}/jellyfin with API key fixture-jellyfin-token. Open Users and pair Alex with the seeded Alex Plex Home profile. Preview should show five updates (three watched, two resume positions), four matched pairs, one position conflict, and two ambiguous specials; the second sync should show zero. Inspect ${base}/fixture-state for watched item IDs and resume positions on each service. Stop this process when finished. Its PostgreSQL container is isolated and stops with this process.`,
);

async function stop() {
	server.stop(true);
	await container.stop();
	process.exit(0);
}
process.once("SIGINT", () => {
	void stop();
});
process.once("SIGTERM", () => {
	void stop();
});
