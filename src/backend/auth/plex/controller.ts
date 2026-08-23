import Elysia from "elysia";
import {
	PLEX_CALLBACK,
	PLEX_LOGIN_START,
	PLEX_PREFIX,
} from "~/backend/auth/plex/endpoints";
import {
	handlePlexCallback,
	startPlexLogin,
} from "~/backend/auth/plex/service";

export const plexRoutes = new Elysia({ prefix: PLEX_PREFIX })
	.get(PLEX_LOGIN_START, async ({ request }) => {
		const forwardUrl = new URL(request.url).origin;
		return await startPlexLogin(forwardUrl);
	})
	.get(PLEX_CALLBACK, async ({ request }) => ({
		callbackData: await handlePlexCallback(request),
	}));
