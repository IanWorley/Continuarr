/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";

import { ApplicationConfig, getHealthReport } from "~/backend/health/service";

const TEST_APPLICATION_NAME = "Continuarr unit test";

describe("getHealthReport", () => {
	it("uses the application config supplied by a test layer", async () => {
		const testLayer = Layer.succeed(ApplicationConfig, {
			applicationName: TEST_APPLICATION_NAME,
		});

		const report = await Effect.runPromise(
			getHealthReport.pipe(Effect.provide(testLayer)),
		);

		expect(report).toEqual({
			application: TEST_APPLICATION_NAME,
			status: "ok",
		});
	});
});
