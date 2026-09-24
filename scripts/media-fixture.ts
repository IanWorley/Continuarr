import { migrate } from "drizzle-orm/node-postgres/migrator";
import { GenericContainer, Wait } from "testcontainers";
import { z } from "zod";
import {
	CREDENTIAL_KEY_BYTES,
	createSecretStorage,
	Secret,
} from "../src/backend/secrets/storage";
import { createDatabase } from "../src/db/database";
import * as schema from "../src/db/schema";

const FIXTURE_PORT = 43123;
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
const plexWatched = new Set(["1"]);
const jellyfinWatched = new Set(["j2"]);
const titles = ["Arrival", "The Martian"];
const ids = ["329865", "286217"];
function plexItem(index: number) {
	const id = String(index + 1);
	return {
		ratingKey: id,
		type: "movie",
		title: titles[index],
		Guid: [{ id: `tmdb://${ids[index]}` }],
		...(plexWatched.has(id) ? { viewCount: 1 } : {}),
	};
}
function jellyfinItem(index: number) {
	const id = `j${index + 1}`;
	return {
		Id: id,
		Name: titles[index],
		Type: "Movie",
		ProviderIds: { Tmdb: ids[index] },
		UserData: { Played: jellyfinWatched.has(id) },
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
				MediaContainer: { Directory: [{ key: "1", type: "movie" }] },
			});
		if (path === "/plex/library/sections/1/all")
			return Response.json({
				MediaContainer: {
					totalSize: 2,
					offset: 0,
					Metadata: [plexItem(0), plexItem(1)],
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
		if (path === "/jellyfin/System/Info/Public")
			return Response.json({
				Id: "fixture-jellyfin-server",
				ServerName: "Fixture Jellyfin",
			});
		if (path === "/jellyfin/Users/AuthenticateByName") {
			const body = z
				.object({ Username: z.string(), Pw: z.string() })
				.parse(await request.json());
			if (body.Username !== "alex" || body.Pw !== "fixture-password")
				return new Response(null, { status: 401 });
			return Response.json({
				AccessToken: "fixture-jellyfin-token",
				ServerId: "fixture-jellyfin-server",
				User: { Id: "alex-id", Name: "Alex" },
			});
		}
		if (
			path.startsWith("/jellyfin/") &&
			!request.headers
				.get("authorization")
				?.endsWith(', Token="fixture-jellyfin-token"')
		)
			return new Response(null, { status: 401 });
		if (path === "/jellyfin/Users/Me")
			return Response.json({ Id: "alex-id", Name: "Alex" });
		if (path === "/jellyfin/Users/alex-id/Items")
			return Response.json({
				Items: [jellyfinItem(0), jellyfinItem(1)],
				TotalRecordCount: 2,
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
	`Fixture running at ${server.url}. Start the app in another terminal:\nDATABASE_URL=${databaseUrl} CREDENTIAL_ENCRYPTION_KEY=${KEY} bun run dev --host 127.0.0.1\nCreate a temporary Continuarr owner in the browser. Connect Jellyfin at ${base}/jellyfin with alex / fixture-password. Pair with the seeded Alex Plex Home profile. Preview should show two writes; the second sync should show zero. Inspect ${base}/fixture-state for both watched item IDs on each service. Stop this process when finished. Its PostgreSQL container is isolated and stops with this process.`,
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
