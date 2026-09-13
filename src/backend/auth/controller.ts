import { Elysia } from "elysia";
import type { AdministratorService } from "~/backend/admin/service";
import { plexRoutes } from "~/backend/auth/plex/controller";
import type { PlexAuthorizationService } from "~/backend/auth/plex/service";

export function authRoutes(
	administrator: AdministratorService,
	plex: PlexAuthorizationService,
) {
	return new Elysia({ prefix: "/auth" }).use(plexRoutes(administrator, plex));
}
