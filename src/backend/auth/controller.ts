import { Elysia } from "elysia";
import {
	createPlexRoutes,
	type PlexRouteDependencies,
} from "~/backend/auth/plex/controller";

export function createAuthRoutes(dependencies: PlexRouteDependencies) {
	return new Elysia({ prefix: "/auth" }).use(createPlexRoutes(dependencies));
}
