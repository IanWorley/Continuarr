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
const plexWatched = new Set(["1", "3"]);
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
];
const ids = ["329865", "286217"];
const MOVIE_COUNT = 2;
const EPISODE_SEASONS = [1, 1, 2];
const EPISODE_NUMBERS = [1, 2, 1];
function plexItem(index: number) {
	const id = String(index + 1);
	const viewOffset = plexPositions.get(id);
	return {
		ratingKey: id,
		type: index < MOVIE_COUNT ? "movie" : "episode",
		Media: [
			{
				Part: [
					{
						file: `/media/${index < MOVIE_COUNT ? "movies" : "tv/Expedition"}/${titles[index]}.mkv`,
					},
				],
			},
		],
		...(index >= MOVIE_COUNT
			? {
					grandparentRatingKey: "show-1",
					grandparentTitle: "Expedition",
					parentIndex: EPISODE_SEASONS[index - MOVIE_COUNT],
					index: EPISODE_NUMBERS[index - MOVIE_COUNT],
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
function jellyfinItem(index: number) {
	const id = `j${index + 1}`;
	return {
		Id: id,
		Name: titles[index],
		Type: index < MOVIE_COUNT ? "Movie" : "Episode",
		Path: `/data/${index < MOVIE_COUNT ? "movies" : "shows/Expedition"}/${titles[index]}.mkv`,
		...(index >= MOVIE_COUNT
			? {
					SeriesId: "series-1",
					SeriesName: "Expedition",
					ParentIndexNumber: EPISODE_SEASONS[index - MOVIE_COUNT],
					IndexNumber: EPISODE_NUMBERS[index - MOVIE_COUNT],
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
					totalSize: 3,
					offset: 0,
					Metadata: [plexItem(2), plexItem(3), plexItem(4)],
				},
			});
		if (path.startsWith("/plex/library/metadata/"))
			return Response.json({
				MediaContainer: {
					Metadata: [plexItem(Number(path.split("/").at(-1)) - 1)],
				},
			});
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
		if (path === "/jellyfin/Users/alex-id/Items")
			return Response.json({
				Items: titles.map((_, index) => jellyfinItem(index)),
				TotalRecordCount: titles.length,
			});
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
	`Fixture running at ${server.url}. Start the app in another terminal:\nDATABASE_URL=${databaseUrl} CREDENTIAL_ENCRYPTION_KEY=${KEY} bun run dev --host 127.0.0.1\nCreate a temporary Continuarr owner in the browser. Open Connections & sync and import Jellyfin at ${base}/jellyfin with API key fixture-jellyfin-token. Open Users and pair Alex with the seeded Alex Plex Home profile. Preview should show two writes; the second sync should show zero. Inspect ${base}/fixture-state for both watched item IDs on each service. Stop this process when finished. Its PostgreSQL container is isolated and stops with this process.`,
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
