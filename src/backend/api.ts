import { Elysia } from "elysia";
import { administratorRoutes } from "~/backend/admin/controller";
import { guardRequest } from "~/backend/admin/guard";
import {
	type AdministratorService,
	administratorService,
} from "~/backend/admin/service";
import { mediaRoutes } from "~/backend/media/controller";

const APPLICATION_NAME = "Continuarr";

export function createApi(
	service: AdministratorService = administratorService,
	media?: Parameters<typeof mediaRoutes>[0],
) {
	return new Elysia({ prefix: "/api/v1" })
		.onRequest(async ({ request, status, set }) => {
			set.headers["cache-control"] = "no-store";
			const rejection = await guardRequest(request, service);
			if (rejection)
				return rejection.status === 403
					? status(403, { error: "A same-origin request is required." })
					: status(401, { error: "Sign in to Continuarr." });
		})
		.get("/health", () => ({ application: APPLICATION_NAME, status: "ok" }))
		.use(administratorRoutes(service))
		.use(mediaRoutes(media));
}

export const api = createApi();
export type Api = typeof api;
