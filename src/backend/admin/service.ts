import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { createAdministratorRepository } from "~/backend/admin/repo";

export const SESSION_COOKIE = "continuarr_session";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;
export {
	MAX_PASSWORD_LENGTH,
	MAX_USERNAME_LENGTH,
	MIN_PASSWORD_LENGTH,
} from "~/backend/admin/model";

// Each scrypt derivation needs roughly 128 MiB; bound work across service instances.
export const MAX_CONCURRENT_PASSWORD_DERIVATIONS = 2;
let activePasswordDerivations = 0;

export class PasswordDerivationBusyError extends Error {
	constructor() {
		super("Authentication is busy. Please retry.");
	}
}

const TOKEN_BYTES = 32;
const SETUP_CODE_BYTES = 16;

export class InvalidSetupCodeError extends Error {
	constructor() {
		super("Invalid setup code. Use the current code from the server logs.");
	}
}
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const SCRYPT_COST = 131072;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const SCRYPT_MAX_MEMORY = 256 * 1024 * 1024;
const MILLISECONDS_PER_SECOND = 1000;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

async function deriveKey(password: string, salt: string): Promise<Buffer> {
	if (activePasswordDerivations >= MAX_CONCURRENT_PASSWORD_DERIVATIONS)
		throw new PasswordDerivationBusyError();
	activePasswordDerivations += 1;
	try {
		return await new Promise<Buffer>((resolve, reject) => {
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
	} finally {
		activePasswordDerivations -= 1;
	}
}

async function hashPassword(password: string) {
	const salt = randomBytes(SALT_BYTES).toString("hex");
	const key = await deriveKey(password, salt);
	return `${salt}:${key.toString("hex")}`;
}

function tokenHashBuffer(token: string) {
	return createHash("sha256").update(token).digest();
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
	const secure = new URL(request.url).protocol === "https:";
	return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function createAdministratorService(
	database?: Parameters<typeof createAdministratorRepository>[0],
	now = () => Math.floor(Date.now() / MILLISECONDS_PER_SECOND),
) {
	const repository = createAdministratorRepository(database);
	let setupCode: string | undefined;
	let initialized = false;
	return {
		initializeSetup(log: (message: string) => void = console.info) {
			if (initialized) return;
			if (repository.isConfigured()) {
				log("Administrator configured; sign in to continue.");
			} else {
				setupCode = randomBytes(SETUP_CODE_BYTES).toString("hex");
				log(
					`Continuarr first-time setup code: ${setupCode}. Open /sign-in and paste this code to create the administrator.`,
				);
			}
			initialized = true;
		},
		isConfigured() {
			return repository.isConfigured();
		},
		async bootstrap(username: string, password: string, code: string) {
			if (this.isConfigured()) return false;
			if (
				!setupCode ||
				!timingSafeEqual(tokenHashBuffer(code), tokenHashBuffer(setupCode))
			)
				throw new InvalidSetupCodeError();
			const passwordHash = await hashPassword(password);
			const created = repository.createOwner(username, passwordHash);
			if (repository.isConfigured()) setupCode = undefined;
			return created;
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
