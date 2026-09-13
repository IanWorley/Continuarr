import { Elysia } from "elysia";
import { administratorRoutes } from "~/backend/admin/controller";
import { guardRequest } from "~/backend/admin/guard";
import {
	type AdministratorService,
	administratorService,
} from "~/backend/admin/service";
import { authRoutes } from "~/backend/auth/controller";

import {
	createPlexAuthorizationService,
	type PlexAuthorizationService,
} from "~/backend/auth/plex/service";

const APPLICATION_NAME = "Continuarr";

export function createApi(
	service: AdministratorService = administratorService,
	plex: PlexAuthorizationService = createPlexAuthorizationService(),
) {
	return new Elysia({ prefix: "/api/v1" })
		.onRequest(({ request, status, set }) => {
			set.headers["cache-control"] = "no-store";
			const rejection = guardRequest(request, service);
			if (rejection)
				return rejection.status === 403
					? status(403, { error: "A same-origin request is required." })
					: status(401, { error: "Sign in to Continuarr." });
		})
		.get("/health", () => ({ application: APPLICATION_NAME, status: "ok" }))
		.use(administratorRoutes(service))
		.use(authRoutes(service, plex));
}

export const api = createApi();
export type Api = typeof api;
