import { Effect, type Layer } from "effect";
import { Elysia } from "elysia";

import { RequestContext } from "~/backend/health/request-context";
import {
	type ApplicationConfig,
	getHealthReport,
} from "~/backend/health/service";

export const REQUEST_ID_HEADER_NAME = "x-request-id";

export type HealthLayer = Layer.Layer<
	ApplicationConfig | RequestContext,
	never,
	never
>;

const getHealthResponse = Effect.all({
	report: getHealthReport,
	requestContext: RequestContext,
});

export function createHealthRoutes(layer: HealthLayer) {
	return new Elysia().get("/health", async ({ set }) => {
		const { report, requestContext } = await Effect.runPromise(
			getHealthResponse.pipe(Effect.provide(layer)),
		);

		set.headers[REQUEST_ID_HEADER_NAME] = requestContext.requestId;
		return report;
	});
}
