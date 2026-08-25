import { Layer } from "effect";

import {
	type CreateRequestId,
	RequestIdGenerator,
	requestContextLive,
} from "~/backend/health/request-context";
import { ApplicationConfig } from "~/backend/health/service";

const APPLICATION_NAME = "Continuarr";

export interface ApplicationDependencies {
	readonly applicationName: string;
	readonly createRequestId: CreateRequestId;
}

const defaultDependencies: ApplicationDependencies = {
	applicationName: APPLICATION_NAME,
	createRequestId: () => crypto.randomUUID(),
};

export function createApplicationLayer(
	dependencies: ApplicationDependencies = defaultDependencies,
) {
	const applicationConfig = Layer.succeed(ApplicationConfig, {
		applicationName: dependencies.applicationName,
	});
	const requestIdGenerator = Layer.succeed(RequestIdGenerator, {
		createRequestId: dependencies.createRequestId,
	});
	const requestContext = requestContextLive.pipe(
		Layer.provide(requestIdGenerator),
	);

	return Layer.merge(applicationConfig, requestContext);
}
