/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import { treaty } from "@elysia/eden";

import { api } from "~/backend/api";

const API_ORIGIN = "http://localhost";
const EXPECTED_HEALTH_RESPONSE = {
	application: "Continuarr",
	status: "ok",
};

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
});
