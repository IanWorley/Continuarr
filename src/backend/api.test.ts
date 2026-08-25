/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import { treaty } from "@elysia/eden";

import { createApi } from "~/backend/api";

const API_ORIGIN = "http://localhost";
const AUTHORIZATION_URL = "https://app.plex.tv/auth/example";
const EXPECTED_HEALTH_RESPONSE = {
	application: "Continuarr",
	status: "ok",
};
const api = createApi({
	startPlexLogin: async () => AUTHORIZATION_URL,
});

describe("Elysia API", () => {
	it("returns health information over HTTP", async () => {
		const response = await api.handle(
			new Request(`${API_ORIGIN}/api/v1/health`),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(EXPECTED_HEALTH_RESPONSE);
	});

	it("exposes the health endpoint through Eden Treaty", async () => {
		const client = treaty(api).api;
		const { data, error } = await client.v1.health.get();

		expect(error).toBeNull();
		expect(data).toEqual(EXPECTED_HEALTH_RESPONSE);
	});

	it("injects the login function into the Plex route", async () => {
		const response = await api.handle(
			new Request(`${API_ORIGIN}/api/v1/auth/plex/login/start`),
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe(AUTHORIZATION_URL);
	});
});
