import { Elysia, t } from "elysia";
import type { AdministratorService } from "~/backend/admin/service";
import { PlexUnavailableError } from "~/backend/auth/plex/client";
import {
	AuthorizationSessionError,
	type PlexAuthorizationService,
} from "~/backend/auth/plex/service";

export function plexRoutes(
	administrator: AdministratorService,
	service: PlexAuthorizationService,
) {
	return new Elysia().post(
		"/plex/login/start",
		async ({ request, status }) => {
			try {
				return await service.start(request, administrator);
			} catch (error) {
				if (error instanceof AuthorizationSessionError)
					return status(401, { error: error.message });
				if (error instanceof PlexUnavailableError)
					return status(502, { error: error.message });
				return status(500, {
					error: "Unable to save Plex authorization. Please retry.",
				});
			}
		},
		{
			response: {
				200: t.Object({ authorizationUrl: t.String(), expiresAt: t.String() }),
				401: t.Object({ error: t.String() }),
				502: t.Object({ error: t.String() }),
				500: t.Object({ error: t.String() }),
			},
		},
	);
}
