import { migrate } from "drizzle-orm/node-postgres/migrator";
import { GenericContainer, Wait } from "testcontainers";
import { z } from "zod";
import { MILLISECONDS_PER_SECOND } from "../src/backend/media/constants";
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
const plexInProgress = "2";
const jellyfinInProgress = "j4";
const LAST_PLAYED_AT_MS = Date.UTC(2026, 8, 1, 20);
// Only Alex reports activity, so the Users page covers both a real date and "Never".
const ALEX_LAST_ACTIVE_AT = new Date(Date.UTC(2026, 8, 2, 18)).toISOString();
const RESUME_POSITION_MS = 754_000;
const plexPositions = new Map([[plexInProgress, RESUME_POSITION_MS]]);
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
		...(plexWatched.has(id) || id === plexInProgress
			? { lastViewedAt: LAST_PLAYED_AT_MS / MILLISECONDS_PER_SECOND }
			: {}),
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
			...(jellyfinWatched.has(id) || id === jellyfinInProgress
				? { LastPlayedDate: new Date(LAST_PLAYED_AT_MS).toISOString() }
				: {}),
			...(id === jellyfinInProgress
				? { PlaybackPositionTicks: RESUME_POSITION_MS * TICKS_PER_MILLISECOND }
				: {}),
		},
	};
}
const server = Bun.serve({
	port: FIXTURE_PORT,
	hostname: "127.0.0.1",
	async fetch(request) {
		const url = new URL(request.url);
		const path = url.pathname;
		if (path === "/fixture-state")
			return Response.json({
				plex: [...plexWatched],
				plexPositions: Object.fromEntries(plexPositions),
				jellyfin: [...jellyfinWatched],
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
			const key = path.split("/").at(-1);
			const show = SHOWS.find(({ plexKey }) => plexKey === key);
			return Response.json({
				MediaContainer: {
					Metadata: [show ? plexShow(show) : plexItem(Number(key) - 1)],
				},
			});
		}
		if (path === "/plex/:/scrobble") {
			plexWatched.add(url.searchParams.get("key") ?? "");
			return new Response(null, { status: 200 });
		}
		if (path === "/plex/:/progress") {
			plexPositions.set(
				url.searchParams.get("key") ?? "",
				Number(url.searchParams.get("time")),
			);
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
		if (path.startsWith("/jellyfin/Users/alex-id/Items/"))
			return Response.json(
				jellyfinItem(Number(path.split("/").at(-1)?.slice(1)) - 1),
			);
		if (
			path.startsWith("/jellyfin/Users/alex-id/PlayedItems/") &&
			request.method === "POST"
		) {
			jellyfinWatched.add(path.split("/").at(-1) ?? "");
			return new Response(null, { status: 204 });
		}
		return new Response("Fixture endpoint not found", { status: 404 });
	},
});
console.log(
	`Fixture running at ${server.url}. Start the app in another terminal:\nDATABASE_URL=${databaseUrl} CREDENTIAL_ENCRYPTION_KEY=${KEY} bun run dev --host 127.0.0.1\nCreate a temporary Continuarr owner in the browser. Open Connections & sync and import Jellyfin at ${base}/jellyfin with API key fixture-jellyfin-token. Open Users and pair Alex with the seeded Alex Plex Home profile. Preview should show three writes, four matched pairs, and two ambiguous specials; the second sync should show zero. Inspect ${base}/fixture-state for both watched item IDs on each service. Stop this process when finished. Its PostgreSQL container is isolated and stops with this process.`,
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
