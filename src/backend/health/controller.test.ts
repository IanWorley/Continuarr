/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";

import { createApi } from "~/backend/api";
import { RequestContext } from "~/backend/health/request-context";
import { ApplicationConfig } from "~/backend/health/service";

const API_ORIGIN = "http://localhost";
const TEST_APPLICATION_NAME = "Continuarr lifecycle test";
const TEST_REQUEST_ID = "scoped-request-id";

describe("health request lifecycle", () => {
	it("releases a scoped request context after the handler completes", async () => {
		const releasedRequestIds: string[] = [];
		const applicationConfig = Layer.succeed(ApplicationConfig, {
			applicationName: TEST_APPLICATION_NAME,
		});
		const requestContext = Layer.scoped(
			RequestContext,
			Effect.acquireRelease(
				Effect.succeed({ requestId: TEST_REQUEST_ID }),
				({ requestId }) =>
					Effect.sync(() => {
						releasedRequestIds.push(requestId);
					}),
			),
		);
		const testApi = createApi(Layer.merge(applicationConfig, requestContext));

		const response = await testApi.handle(
			new Request(`${API_ORIGIN}/api/v1/health`),
		);

		expect(response.status).toBe(200);
		expect(releasedRequestIds).toEqual([TEST_REQUEST_ID]);
	});
});
