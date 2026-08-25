/// <reference types="bun" />

import { describe, expect, it } from "bun:test";

import { createApplicationContainer } from "~/backend/container";

const TEST_APPLICATION_NAME = "Continuarr test";
const FIRST_REQUEST_ID = "request-one";
const SECOND_REQUEST_ID = "request-two";

describe("application container lifetimes", () => {
	it("reuses the health service across request scopes", async () => {
		const container = createApplicationContainer({
			applicationName: TEST_APPLICATION_NAME,
			createRequestId: () => FIRST_REQUEST_ID,
		});
		const firstScope = container.createScope();
		const secondScope = container.createScope();

		try {
			expect(firstScope.cradle.healthService).toBe(
				secondScope.cradle.healthService,
			);
		} finally {
			await container.dispose();
		}
	});

	it("isolates request context values between request scopes", async () => {
		let requestId = FIRST_REQUEST_ID;
		const container = createApplicationContainer({
			applicationName: TEST_APPLICATION_NAME,
			createRequestId: () => requestId,
		});
		const firstScope = container.createScope();
		const firstRequestContext = firstScope.cradle.requestContext;

		requestId = SECOND_REQUEST_ID;
		const secondScope = container.createScope();

		try {
			expect(firstScope.cradle.requestContext).toBe(firstRequestContext);
			expect(firstRequestContext.requestId).toBe(FIRST_REQUEST_ID);
			expect(secondScope.cradle.requestContext.requestId).toBe(
				SECOND_REQUEST_ID,
			);
		} finally {
			await container.dispose();
		}
	});
});
