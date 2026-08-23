import { Elysia } from "elysia";
import { authRoutes } from "~/backend/auth/controller";
import { API_PREFIX } from "~/backend/auth/plex/endpoints";

const APPLICATION_NAME = "Continuarr";

export const api = new Elysia({ prefix: API_PREFIX })
	.get("/health", () => ({
		application: APPLICATION_NAME,
		status: "ok",
	}))
	.use(authRoutes);

export type Api = typeof api;
