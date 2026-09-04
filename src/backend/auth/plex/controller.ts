import Elysia, { t } from "elysia";
import {
	LOGIN_COOKIE,
	LOGIN_TTL_MS,
	MILLISECONDS_PER_SECOND,
	SESSION_COOKIE,
	SESSION_TTL_MS,
} from "~/backend/auth/plex/constants";
import { deleteSession, sessionUser } from "~/backend/auth/plex/repo";
import { hashSecret, randomSecret } from "~/backend/auth/plex/secrets";
import { PlexLoginError, plexLoginService } from "~/backend/auth/plex/service";

function sameOrigin(request: Request) {
	return request.headers.get("origin") === new URL(request.url).origin;
}

function cookieOptions(request: Request, ttl: number) {
	return {
		httpOnly: true,
		secure: new URL(request.url).protocol === "https:",
		sameSite: "lax" as const,
		path: "/",
		maxAge: ttl / MILLISECONDS_PER_SECOND,
	};
}

export const plexRoutes = new Elysia({ prefix: "/plex/login" })
	.onError(({ code, error, status }) => {
		if (code === "VALIDATION")
			return status(422, { message: "Invalid login request" });
		if (error instanceof PlexLoginError)
			return status(401, { message: error.message });
		return status(500, { message: "Unable to complete Plex sign-in" });
	})
	.onBeforeHandle(({ set }) => {
		set.headers["cache-control"] = "no-store";
	})
	// Preserve the old route's type contract while the frontend PR is stacked.
	.get("/start", ({ status }) => status(405, "Use POST to start Plex sign-in"))
	.post("/start", async ({ request, cookie, status }) => {
		if (!sameOrigin(request))
			return status(403, { message: "Invalid request origin" });
		const browserSecret = randomSecret();
		const result = await plexLoginService.start(
			new URL(request.url).origin,
			browserSecret,
		);
		cookie[LOGIN_COOKIE].set({
			...cookieOptions(request, LOGIN_TTL_MS),
			value: browserSecret,
		});
		return result;
	})
	.post(
		"/complete",
		async ({ request, cookie, body, status }) => {
			if (!sameOrigin(request))
				return status(403, { message: "Invalid request origin" });
			const browserSecret = cookie[LOGIN_COOKIE].value;
			if (typeof browserSecret !== "string")
				return status(401, { message: "Start Plex sign-in again" });
			const result = await plexLoginService.complete(body.state, browserSecret);
			if (result.status === "pending") return result;
			const previousSession = cookie[SESSION_COOKIE].value;
			if (typeof previousSession === "string")
				deleteSession(hashSecret(previousSession));
			cookie[SESSION_COOKIE].set({
				...cookieOptions(request, SESSION_TTL_MS),
				value: result.sessionToken,
			});
			cookie[LOGIN_COOKIE].set({ ...cookieOptions(request, 0), value: "" });
			return { status: result.status, user: result.user };
		},
		{ body: t.Object({ state: t.String({ format: "uuid" }) }) },
	)
	.get("/me", ({ cookie, status }) => {
		const token = cookie[SESSION_COOKIE].value;
		const user =
			typeof token === "string" ? sessionUser(hashSecret(token)) : undefined;
		return user ?? status(401, { message: "Not signed in" });
	})
	.post("/logout", ({ request, cookie, status }) => {
		if (!sameOrigin(request))
			return status(403, { message: "Invalid request origin" });
		const token = cookie[SESSION_COOKIE].value;
		if (typeof token === "string") deleteSession(hashSecret(token));
		cookie[SESSION_COOKIE].set({ ...cookieOptions(request, 0), value: "" });
		return { status: "signed_out" as const };
	});
