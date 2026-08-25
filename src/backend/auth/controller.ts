import { Elysia } from "elysia";
import type { createPlexRoutes } from "~/backend/auth/plex/controller";

export interface AuthRoutesDependencies {
	plexRoutes: ReturnType<typeof createPlexRoutes>;
}

export function createAuthRoutes(dependencies: AuthRoutesDependencies) {
	return new Elysia({ prefix: "/auth" }).use(dependencies.plexRoutes);
}
