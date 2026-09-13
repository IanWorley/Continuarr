import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { createAdministratorRepository } from "~/backend/admin/repo";

export const SESSION_COOKIE = "continuarr_session";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;
export {
	MAX_PASSWORD_LENGTH,
	MAX_USERNAME_LENGTH,
	MIN_PASSWORD_LENGTH,
} from "~/backend/admin/model";

const TOKEN_BYTES = 32;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const SCRYPT_COST = 131072;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const SCRYPT_MAX_MEMORY = 256 * 1024 * 1024;
const MILLISECONDS_PER_SECOND = 1000;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

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
	database?: Parameters<typeof createAdministratorRepository>[0],
	now = () => Math.floor(Date.now() / MILLISECONDS_PER_SECOND),
) {
	const repository = createAdministratorRepository(database);
	return {
		isConfigured() {
			return repository.isConfigured();
		},
		async bootstrap(username: string, password: string) {
			if (this.isConfigured()) return false;
			const passwordHash = await hashPassword(password);
			return repository.createOwner(username, passwordHash);
		},
		async signIn(username: string, password: string) {
			const owner = repository.getOwner();
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
			const timestamp = now();
			repository.deleteExpiredSessions(timestamp);
			repository.createSession(
				tokenHash(token),
				timestamp + SESSION_DURATION_SECONDS,
			);
			return token;
		},
		authenticate(request: Request) {
			const token = readSessionToken(request);
			if (!token) return false;
			return repository.hasActiveSession(tokenHash(token), now());
		},
		signOut(request: Request) {
			const token = readSessionToken(request);
			if (token) repository.deleteSession(tokenHash(token));
		},
	};
}

export const administratorService = createAdministratorService();
export type AdministratorService = ReturnType<
	typeof createAdministratorService
>;
