import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { Pool } from "pg";
import { z } from "zod";
import { Secret } from "../src/backend/secrets/storage";
import { secretStorage } from "../src/backend/secrets/storage.server";

const CONNECTION_ID = "deployment-account";
const FIXTURE_SECRET = "disposable-deployment-credential";
const SERVICE_UID = 1000;
const POSTGRES_MAJOR_VERSION = "18";
const KEY_MODE = 0o600;
const PERMISSION_BITS = 0o777;
const KEY_PATH = "/data/credential-encryption.key";
const mode = z
	.enum(["seed", "check", "seed-upgrade", "check-upgrade", "metadata"])
	.parse(process.argv[2]);
const database = new Pool({ connectionString: process.env.DATABASE_URL });

try {
	const packageManager = z
		.object({ packageManager: z.string().startsWith("bun@") })
		.parse(await Bun.file("package.json").json()).packageManager;
	assert.equal(
		Bun.version,
		packageManager.slice("bun@".length),
		"runtime Bun matches package manager",
	);
	const postgres = await database.query(
		"SELECT current_setting('server_version') AS version",
	);
	const postgresVersion = z.string().parse(postgres.rows[0]?.version);
	assert.equal(
		postgresVersion.split(".")[0],
		POSTGRES_MAJOR_VERSION,
		"PostgreSQL major version",
	);
	assert.equal(process.getuid?.(), SERVICE_UID, "runtime user");
	const metadata = await stat(KEY_PATH);
	assert.equal(metadata.uid, SERVICE_UID, "key owner");
	assert.equal(metadata.mode & PERMISSION_BITS, KEY_MODE, "key mode");
	if (mode === "seed" || mode === "seed-upgrade") {
		const encrypted = secretStorage.encrypt(
			CONNECTION_ID,
			new Secret(FIXTURE_SECRET),
		);
		assert.notEqual(encrypted, FIXTURE_SECRET);
		await database.query(
			"INSERT INTO plex_accounts (id,user_id,name,token) VALUES ($1,$1,'Deployment fixture',$2)",
			[CONNECTION_ID, encrypted],
		);
		if (mode === "seed-upgrade") {
			await database.query(`
				INSERT INTO administrator VALUES (1,'retained-owner','retained-password-hash');
				INSERT INTO administrator_sessions VALUES ('retained-session',1,4102444800);
				INSERT INTO application_settings (key,value) VALUES ('deployment-retained','retained-setting');
				INSERT INTO plex_profiles (id,account_id,user_id,name,server_id,server_name,url,token) VALUES ('retained-plex','deployment-account','retained-user','Retained Plex','retained-server','Server','http://fixture.invalid',NULL);
				INSERT INTO jellyfin_profiles (id,user_id,name,server_id) VALUES ('retained-jellyfin','retained-user','Retained Jellyfin','retained-server');
				INSERT INTO sync_pairings (id,plex_profile_id,jellyfin_profile_id) VALUES ('retained-pairing','retained-plex','retained-jellyfin');
				INSERT INTO manual_matches VALUES ('retained-pairing','retained-plex-item','retained-jellyfin-item');
				INSERT INTO sync_runs (id,pairing_id,started_at,status,summary) VALUES ('retained-run','retained-pairing',1,'completed','retained-summary');
			`);
		}
	}
	if (mode === "check" || mode === "check-upgrade") {
		const result = await database.query(
			"SELECT token FROM plex_accounts WHERE id=$1",
			[CONNECTION_ID],
		);
		const token = z.string().parse(result.rows[0]?.token);
		assert.equal(
			secretStorage.decrypt(CONNECTION_ID, token).reveal(),
			FIXTURE_SECRET,
			"encrypted credential survives",
		);
		if (mode === "check-upgrade") {
			const result = await database.query(`SELECT
				(SELECT username FROM administrator WHERE id=1) AS owner,
				(SELECT token_hash FROM administrator_sessions WHERE administrator_id=1) AS session,
				(SELECT value FROM application_settings WHERE key='deployment-retained') AS setting,
				(SELECT id FROM sync_pairings WHERE id='retained-pairing') AS pairing,
				(SELECT plex_item_id FROM manual_matches WHERE pairing_id='retained-pairing') AS match,
				(SELECT summary FROM sync_runs WHERE id='retained-run') AS run`);
			assert.deepEqual(result.rows, [
				{
					owner: "retained-owner",
					session: "retained-session",
					setting: "retained-setting",
					pairing: "retained-pairing",
					match: "retained-plex-item",
					run: "retained-summary",
				},
			]);
		}
	}
	const history = await database.query(
		"SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at",
	);
	const journal = z
		.object({
			entries: z.array(z.object({ tag: z.string(), when: z.number() })),
		})
		.parse(await Bun.file("drizzle/postgres/meta/_journal.json").json());
	const expected = await Promise.all(
		journal.entries.map(async (entry) => ({
			hash: createHash("sha256")
				.update(await readFile(`drizzle/postgres/${entry.tag}.sql`))
				.digest("hex"),
			created_at: String(entry.when),
		})),
	);
	assert.deepEqual(
		history.rows,
		expected,
		"migration journal matches database history",
	);
	process.stdout.write(
		`${JSON.stringify({
			result: "PASS",
			check: mode,
			migrations: expected.length,
			bunVersion: Bun.version,
			postgresVersion,
			keyHash: createHash("sha256")
				.update(await readFile(KEY_PATH))
				.digest("hex"),
			uid: metadata.uid,
			mode: "600",
		})}\n`,
	);
} finally {
	await database.end();
}
