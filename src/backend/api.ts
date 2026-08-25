import { Elysia } from "elysia";
import { createAuthRoutes } from "~/backend/auth/controller";
import type { StartPlexLogin } from "~/backend/auth/plex/service";

const APPLICATION_NAME = "Continuarr";

export interface ApiDependencies {
	startPlexLogin: StartPlexLogin;
}

export function createApi(dependencies: ApiDependencies) {
	return new Elysia({ prefix: "/api/v1" })
		.get("/health", () => ({
			application: APPLICATION_NAME,
			status: "ok",
		}))
		.use(createAuthRoutes(dependencies));
}

export type Api = ReturnType<typeof createApi>;
