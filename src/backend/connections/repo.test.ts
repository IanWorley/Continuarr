import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import {
	CREDENTIAL_KEY_BYTES,
	createSecretStorage,
	Secret,
} from "~/backend/secrets/storage";
import * as schema from "~/db/schema";
import {
	createConnectionRepository,
	normalizeServerUrl,
	type SaveConnection,
} from "./repo";

const OWNER_ID = 1;
const TOKEN = "private-access-token";
const NEXT_TOKEN = "rotated-access-token";
const PLEX: SaveConnection = {
	service: "plex",
	serverId: "plex-machine-id",
	url: "HTTP://LOCALHOST:80/plex/",
	displayName: "My Plex",
	credential: new Secret(TOKEN),
};
const JELLYFIN: SaveConnection = {
	...PLEX,
	service: "jellyfin",
	serverId: "jellyfin-server-id",
};
const storage = createSecretStorage(
	randomBytes(CREDENTIAL_KEY_BYTES).toString("base64"),
);
let directory: string;
let client: Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let repo: ReturnType<typeof createConnectionRepository>;

function open() {
	client = new Database(join(directory, "connections.db"));
	client.exec("PRAGMA foreign_keys = ON");
	db = drizzle({ client, schema });
	migrate(db, { migrationsFolder: "drizzle" });
	repo = createConnectionRepository(storage, () => db);
}
beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "continuarr-connections-"));
	open();
	db.insert(schema.administrator)
		.values({ id: OWNER_ID, username: "owner", passwordHash: "test-hash" })
		.run();
});
afterEach(() => {
	client.close();
	rmSync(directory, { recursive: true, force: true });
});

it("persists both services and encrypted credentials through a database reopen", () => {
	const saved = [repo.save(PLEX), repo.save(JELLYFIN)];
	client.close();
	open();
	expect(repo.list()).toEqual(saved);
	expect(repo.find("plex")?.url).toBe("http://localhost/plex");
	expect(repo.readCredential("plex")?.reveal()).toBe(TOKEN);
	const row = db.select().from(schema.serverConnections).get();
	expect(row?.encryptedCredential).not.toContain(TOKEN);
	expect(JSON.stringify(repo.list())).not.toContain(
		row?.encryptedCredential ?? TOKEN,
	);
	expect(repo.find("plex")).not.toHaveProperty("credential");
	expect(repo.find("plex")).not.toHaveProperty("encryptedCredential");
});

it("reconnects the same server without changing identity or creation time", () => {
	const first = repo.save(PLEX);
	repo.setStatus("plex", "revoked");
	const reconnected = repo.save({
		...PLEX,
		credential: new Secret(NEXT_TOKEN),
		displayName: "Renamed",
		url: "https://example.com/plex",
	});
	expect(reconnected).toMatchObject({
		id: first.id,
		createdAt: first.createdAt,
		status: "connected",
		displayName: "Renamed",
		url: "https://example.com/plex",
	});
	expect(repo.readCredential("plex")?.reveal()).toBe(NEXT_TOKEN);
	expect(repo.list()).toHaveLength(1);
});

it("rejects changing servers even when the saved connection is unavailable", () => {
	const first = repo.save(PLEX);
	repo.setStatus("plex", "unavailable");
	expect(() => repo.save({ ...PLEX, serverId: "another-server" })).toThrow(
		"Remove the existing connection",
	);
	expect(repo.find("plex")).toMatchObject({
		id: first.id,
		serverId: first.serverId,
		status: "unavailable",
	});
	expect(repo.readCredential("plex")?.reveal()).toBe(TOKEN);
});

it("enforces one stored connection per service in SQLite regardless of status", () => {
	repo.save(PLEX);
	repo.setStatus("plex", "revoked");
	const row = db.select().from(schema.serverConnections).get();
	if (!row) throw new Error("Expected stored connection");
	expect(() =>
		db
			.insert(schema.serverConnections)
			.values({ ...row, id: "duplicate", status: "connected" })
			.run(),
	).toThrow();
});

it("removes credentials with a connection and gives an explicit replacement a new identity", () => {
	const first = repo.save(PLEX);
	repo.save(JELLYFIN);
	expect(repo.remove("plex")).toBe(true);
	expect(repo.find("plex")).toBeNull();
	expect(repo.readCredential("plex")).toBeNull();
	expect(repo.remove("plex")).toBe(false);
	expect(repo.find("jellyfin")).not.toBeNull();
	expect(repo.save({ ...PLEX, serverId: "replacement" }).id).not.toBe(first.id);
});

it("requires an owner and removes connections when that owner is removed", () => {
	repo.save(PLEX);
	db.delete(schema.administrator).run();
	expect(repo.list()).toEqual([]);
	expect(() => repo.save(JELLYFIN)).toThrow();
});

it("rejects ciphertext copied from a different connection", () => {
	repo.save(PLEX);
	repo.save(JELLYFIN);
	const row = db
		.select()
		.from(schema.serverConnections)
		.where(eq(schema.serverConnections.service, "plex"))
		.get();
	if (!row) throw new Error("Expected stored connection");
	db.update(schema.serverConnections)
		.set({ encryptedCredential: row.encryptedCredential })
		.where(eq(schema.serverConnections.service, "jellyfin"))
		.run();
	expect(() => repo.readCredential("jellyfin")).toThrow(
		"Unable to process stored credential",
	);
});

it.each([
	"ftp://host",
	"https://user:password@host",
	"https://host?token=secret",
	"https://host/#fragment",
	"invalid",
])("rejects unsafe or invalid URL %s without retaining it in errors", (url) => {
	expect(() => repo.save({ ...PLEX, url })).toThrow(
		"Server URL must be HTTP(S)",
	);
	expect(repo.list()).toEqual([]);
});

it("normalizes hosts and default ports while preserving reverse-proxy paths", () => {
	expect(normalizeServerUrl(" HTTPS://EXAMPLE.COM:443/jellyfin/ ")).toBe(
		"https://example.com/jellyfin",
	);
	expect(normalizeServerUrl("http://localhost:8096")).toBe(
		"http://localhost:8096",
	);
});
