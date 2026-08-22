import { Elysia } from "elysia";

const APPLICATION_NAME = "Continuarr";

export const api = new Elysia({ prefix: "/api" }).get("/health", () => ({
	application: APPLICATION_NAME,
	status: "ok",
}));

export type Api = typeof api;
