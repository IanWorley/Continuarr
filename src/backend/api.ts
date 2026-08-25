import { Elysia } from "elysia";
import { authRoutes } from "~/backend/auth/controller";
import {
	createHealthRoutes,
	type HealthLayer,
} from "~/backend/health/controller";
import { createApplicationLayer } from "~/backend/layers";

export function createApi(layer: HealthLayer = createApplicationLayer()) {
	return new Elysia({ prefix: "/api/v1" })
		.use(createHealthRoutes(layer))
		.use(authRoutes);
}

export const api = createApi();

export type Api = typeof api;
