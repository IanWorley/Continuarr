import { Elysia } from "elysia";
import { authRoutes } from "~/backend/auth/controller";

const APPLICATION_NAME = "Continuarr";

export const api = new Elysia({ prefix: "/api/v1" })
	.get("/health", () => ({
		application: APPLICATION_NAME,
		status: "ok",
	}))
	.use(authRoutes);

export type Api = typeof api;
