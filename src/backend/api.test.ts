/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import { treaty } from "@elysia/eden";

import { api, createApi } from "~/backend/api";
import { createApplicationContainer } from "~/backend/container";
import { REQUEST_ID_HEADER_NAME } from "~/backend/health/controller";

const API_ORIGIN = "http://localhost";
const EXPECTED_HEALTH_RESPONSE = {
	application: "Continuarr",
	status: "ok",
} as const;
const TEST_APPLICATION_NAME = "Continuarr test";
const TEST_REQUEST_ID = "test-request-id";

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

	it("accepts replacement dependencies at the composition root", async () => {
		const testApi = createApi(
			createApplicationContainer({
				applicationName: TEST_APPLICATION_NAME,
				createRequestId: () => TEST_REQUEST_ID,
			}),
		);
		const response = await testApi.handle(
			new Request(`${API_ORIGIN}/api/v1/health`),
		);

		expect(response.headers.get(REQUEST_ID_HEADER_NAME)).toBe(TEST_REQUEST_ID);
		expect(await response.json()).toEqual({
			application: TEST_APPLICATION_NAME,
			status: "ok",
		});
	});
});
