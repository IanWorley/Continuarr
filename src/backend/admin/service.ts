import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lte } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { getDatabase } from "~/db/database";
import type * as schema from "~/db/schema";
import { administrator, administratorSessions } from "~/db/schema";

export const SESSION_COOKIE = "continuarr_session";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;
export {
	MAX_PASSWORD_LENGTH,
	MAX_USERNAME_LENGTH,
	MIN_PASSWORD_LENGTH,
} from "~/backend/admin/model";

const OWNER_ID = 1;
const TOKEN_BYTES = 32;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const SCRYPT_COST = 131072;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const SCRYPT_MAX_MEMORY = 256 * 1024 * 1024;
const MILLISECONDS_PER_SECOND = 1000;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

type Database = BaseSQLiteDatabase<"sync", unknown, typeof schema>;

function deriveKey(password: string, salt: string): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(
			password,
			salt,
			KEY_BYTES,
			{
				N: SCRYPT_COST,
				r: SCRYPT_BLOCK_SIZE,
				p: SCRYPT_PARALLELISM,
				maxmem: SCRYPT_MAX_MEMORY,
			},
			(error, key) => (error ? reject(error) : resolve(key)),
		);
	});
}

async function hashPassword(password: string) {
	const salt = randomBytes(SALT_BYTES).toString("hex");
	const key = await deriveKey(password, salt);
	return `${salt}:${key.toString("hex")}`;
}

function tokenHash(token: string) {
	return createHash("sha256").update(token).digest("hex");
}

export function readSessionToken(request: Request) {
	const cookie = request.headers
		.get("cookie")
		?.split(";")
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${SESSION_COOKIE}=`));
	const token = cookie?.slice(SESSION_COOKIE.length + 1);
	return token && TOKEN_PATTERN.test(token) ? token : undefined;
}

export function sessionCookie(
	request: Request,
	token: string,
	maxAge = SESSION_DURATION_SECONDS,
) {
	const secure =
		new URL(request.url).protocol === "https:" ||
		process.env.NODE_ENV === "production";
	return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function createAdministratorService(
	database: () => Database = () => getDatabase().db,
	now = () => Math.floor(Date.now() / MILLISECONDS_PER_SECOND),
) {
	return {
		isConfigured() {
			return Boolean(
				database().select({ id: administrator.id }).from(administrator).get(),
			);
		},
		async bootstrap(username: string, password: string) {
			const db = database();
			if (this.isConfigured()) return false;
			const passwordHash = await hashPassword(password);
			return Boolean(
				db
					.insert(administrator)
					.values({ id: OWNER_ID, username, passwordHash })
					.onConflictDoNothing()
					.returning({ id: administrator.id })
					.get(),
			);
		},
		async signIn(username: string, password: string) {
			const db = database();
			const owner = db.select().from(administrator).get();
			// Always derive a key so unknown usernames do not skip the expensive password check.
			const [salt, storedKey] = owner?.passwordHash.split(":") ?? [
				"unconfigured",
				"",
			];
			const key = await deriveKey(password, salt);
			if (
				!owner ||
				owner.username !== username ||
				!timingSafeEqual(key, Buffer.from(storedKey, "hex"))
			)
				return null;
			const token = randomBytes(TOKEN_BYTES).toString("hex");
			db.delete(administratorSessions)
				.where(lte(administratorSessions.expiresAt, now()))
				.run();
			db.insert(administratorSessions)
				.values({
					tokenHash: tokenHash(token),
					administratorId: OWNER_ID,
					expiresAt: now() + SESSION_DURATION_SECONDS,
				})
				.run();
			return token;
		},
		authenticate(request: Request) {
			const token = readSessionToken(request);
			if (!token) return false;
			return Boolean(
				database()
					.select({ tokenHash: administratorSessions.tokenHash })
					.from(administratorSessions)
					.where(
						and(
							eq(administratorSessions.tokenHash, tokenHash(token)),
							gt(administratorSessions.expiresAt, now()),
						),
					)
					.get(),
			);
		},
		signOut(request: Request) {
			const token = readSessionToken(request);
			if (token)
				database()
					.delete(administratorSessions)
					.where(eq(administratorSessions.tokenHash, tokenHash(token)))
					.run();
		},
	};
}

export const administratorService = createAdministratorService();
export type AdministratorService = ReturnType<
	typeof createAdministratorService
>;
