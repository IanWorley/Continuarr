import Elysia from "elysia";
import type { StartPlexLogin } from "~/backend/auth/plex/service";

export interface PlexRouteDependencies {
	startPlexLogin: StartPlexLogin;
}

export function createPlexRoutes({ startPlexLogin }: PlexRouteDependencies) {
	return new Elysia().get("/plex/login/start", startPlexLogin);
}
