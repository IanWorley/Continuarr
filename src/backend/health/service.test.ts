/// <reference types="bun" />

import { describe, expect, it } from "bun:test";

import { createHealthService } from "~/backend/health/service";

const TEST_APPLICATION_NAME = "Continuarr test";
const EXPECTED_HEALTH_REPORT = {
	application: TEST_APPLICATION_NAME,
	status: "ok",
} as const;

describe("health service", () => {
	it("uses an injected application name without a container", () => {
		const healthService = createHealthService({
			applicationName: TEST_APPLICATION_NAME,
		});

		expect(healthService.getReport()).toEqual(EXPECTED_HEALTH_REPORT);
	});
});
