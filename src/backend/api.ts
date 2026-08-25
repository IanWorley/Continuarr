import { Elysia } from "elysia";
import { authRoutes } from "~/backend/auth/controller";
import {
	type ApplicationContainer,
	createApplicationContainer,
} from "~/backend/container";
import { createHealthRoutes } from "~/backend/health/controller";

export function createApi(
	container: ApplicationContainer = createApplicationContainer(),
) {
	return new Elysia({ prefix: "/api/v1" })
		.use(createHealthRoutes(container))
		.use(authRoutes);
}

export const api = createApi();

export type Api = typeof api;
