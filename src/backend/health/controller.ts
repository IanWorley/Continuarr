import { Elysia } from "elysia";

import type { ApplicationContainer } from "~/backend/container";

export const REQUEST_ID_HEADER_NAME = "x-request-id";

export function createHealthRoutes(container: ApplicationContainer) {
	return new Elysia().get("/health", async ({ set }) => {
		const requestScope = container.createScope();

		try {
			const { healthService, requestContext } = requestScope.cradle;
			set.headers[REQUEST_ID_HEADER_NAME] = requestContext.requestId;

			return healthService.getReport();
		} finally {
			await requestScope.dispose();
		}
	});
}
