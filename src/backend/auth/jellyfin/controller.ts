import { Elysia, t } from "elysia";
import {
	createJellyfinClient,
	type JellyfinClient,
	type JellyfinConnection,
	JellyfinError,
} from "~/backend/jellyfin/client";

const COOKIE_NAME = "continuarr_jellyfin";
const COOKIE_PATH = "/api/v1";
const MAX_URL_LENGTH = 2_048;
const MAX_USERNAME_LENGTH = 256;
const MAX_PASSWORD_LENGTH = 4_096;
const INVALID_INPUT = 422;
const EXPIRED_COOKIE = { value: "", path: COOKIE_PATH, maxAge: 0 } as const;
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1_000;
const MILLISECONDS_PER_SECOND = 1_000;
const MAX_SESSIONS = 1_000;
const UNAUTHORIZED = 401;
const BAD_GATEWAY = 502;
const FORBIDDEN = 403;
const SERVICE_UNAVAILABLE = 503;
const REQUEST_HEADER = "x-continuarr-request";

interface Session {
	connection: JellyfinConnection;
	expiresAt: number;
}

// Each browser owns a connection; tokens never enter application settings or API responses.
export function createJellyfinRoutes(
	client: JellyfinClient = createJellyfinClient(),
	now: () => number = Date.now,
) {
	const sessions = new Map<string, Session>();
	function pruneSessions() {
		for (const [id, session] of sessions) {
			if (session.expiresAt <= now()) sessions.delete(id);
		}
	}

	return new Elysia({ prefix: "/jellyfin" })
		.onBeforeHandle(({ request, set, status }) => {
			set.headers["Cache-Control"] = "no-store";
			if (request.method === "GET") return;
			// Requiring a custom header prevents cross-site form submissions.
			const origin = request.headers.get("origin");
			if (
				request.headers.get(REQUEST_HEADER) !== "1" ||
				(origin !== null && origin !== new URL(request.url).origin)
			)
				return status(FORBIDDEN, {
					message: "Use the Continuarr application to manage this connection.",
				});
		})
		.onError(({ error, code, status }) => {
			if (code === "VALIDATION" || code === "PARSE")
				return status(INVALID_INPUT, {
					message: "Enter a server URL, username, and password.",
				});
			if (error instanceof JellyfinError)
				return status(error.status, { message: error.message });
			return status(BAD_GATEWAY, {
				message: "Unable to complete the Jellyfin request.",
			});
		})
		.post(
			"/login",
			async ({ body, cookie, request, status }) => {
				pruneSessions();
				if (sessions.size >= MAX_SESSIONS)
					return status(SERVICE_UNAVAILABLE, {
						message: "Too many active connections. Try again later.",
					});
				const connection = await client.login(
					body.serverUrl,
					body.username,
					body.password,
				);
				const previousId = cookie[COOKIE_NAME].value;
				if (typeof previousId === "string") sessions.delete(previousId);
				const id = crypto.randomUUID();
				sessions.set(id, {
					connection,
					expiresAt: now() + SESSION_LIFETIME_MS,
				});
				cookie[COOKIE_NAME].set({
					value: id,
					httpOnly: true,
					secure: new URL(request.url).protocol === "https:",
					sameSite: "strict",
					path: COOKIE_PATH,
					maxAge: SESSION_LIFETIME_MS / MILLISECONDS_PER_SECOND,
				});
				return { user: connection.user, serverUrl: connection.serverUrl };
			},
			{
				body: t.Object({
					serverUrl: t.String({ minLength: 1, maxLength: MAX_URL_LENGTH }),
					username: t.String({ minLength: 1, maxLength: MAX_USERNAME_LENGTH }),
					password: t.String({ maxLength: MAX_PASSWORD_LENGTH }),
				}),
			},
		)
		.get("/overview", async ({ cookie, status }) => {
			pruneSessions();
			const id = cookie[COOKIE_NAME].value;
			const session = typeof id === "string" ? sessions.get(id) : undefined;
			if (!session)
				return status(UNAUTHORIZED, {
					message: "Log in to Jellyfin to view your instance.",
				});
			try {
				return await client.overview(session.connection);
			} catch (error) {
				if (
					error instanceof JellyfinError &&
					error.status === UNAUTHORIZED &&
					typeof id === "string"
				) {
					sessions.delete(id);
					cookie[COOKIE_NAME].set(EXPIRED_COOKIE);
				}
				throw error;
			}
		})
		.post("/logout", ({ cookie }) => {
			const id = cookie[COOKIE_NAME].value;
			if (typeof id === "string") sessions.delete(id);
			cookie[COOKIE_NAME].set(EXPIRED_COOKIE);
			return { success: true };
		});
}

export const jellyfinRoutes = createJellyfinRoutes();
