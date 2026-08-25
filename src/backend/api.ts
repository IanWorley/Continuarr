import { Elysia } from "elysia";
import { createAuthRoutes } from "~/backend/auth/controller";
import { createPlexLoginClient } from "~/backend/auth/plex/client";
import { createPlexRoutes } from "~/backend/auth/plex/controller";
import { createPlexLoginRepository } from "~/backend/auth/plex/repo";
import { createPlexLoginService } from "~/backend/auth/plex/service";
import { startPlexAuth } from "~/backend/shared/clients/plexclient";
import {
	findApplicationSetting,
	saveApplicationSetting,
} from "~/backend/shared/repo";

const APPLICATION_NAME = "Continuarr";

export function createApi() {
	const repository = createPlexLoginRepository({
		findApplicationSetting,
		saveApplicationSetting,
	});
	const client = createPlexLoginClient({ startPlexAuth });
	const service = createPlexLoginService({
		repository,
		client,
		createClientIdentifier: () => crypto.randomUUID(),
	});
	const plexRoutes = createPlexRoutes({ startPlexLogin: service.startLogin });
	const authRoutes = createAuthRoutes({ plexRoutes });

	return new Elysia({ prefix: "/api/v1" })
		.get("/health", () => ({
			application: APPLICATION_NAME,
			status: "ok",
		}))
		.use(authRoutes);
}

export const api = createApi();

export type Api = ReturnType<typeof createApi>;
