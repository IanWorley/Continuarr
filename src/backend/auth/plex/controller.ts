import Elysia from "elysia";
import type { PlexLoginService } from "~/backend/auth/plex/service";

export interface PlexRoutesDependencies {
	startPlexLogin: PlexLoginService["startLogin"];
}

export function createPlexRoutes(dependencies: PlexRoutesDependencies) {
	return new Elysia().get("/plex/login/start", dependencies.startPlexLogin);
}
