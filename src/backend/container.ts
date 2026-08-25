import {
	type AwilixContainer,
	asFunction,
	asValue,
	createContainer,
	InjectionMode,
	type Resolver,
} from "awilix";

import {
	type CreateRequestId,
	createRequestContext,
	type RequestContext,
} from "~/backend/health/request-context";
import {
	createHealthService,
	type HealthService,
} from "~/backend/health/service";

const APPLICATION_NAME = "Continuarr";

export interface ApplicationDependencies {
	applicationName: string;
	createRequestId: CreateRequestId;
}

export interface ApplicationCradle extends ApplicationDependencies {
	healthService: HealthService;
	requestContext: RequestContext;
}

type ApplicationRegistrations = {
	[Key in keyof ApplicationCradle]: Resolver<ApplicationCradle[Key]>;
};

export type ApplicationContainer = AwilixContainer<ApplicationCradle>;

const defaultDependencies: ApplicationDependencies = {
	applicationName: APPLICATION_NAME,
	createRequestId: () => crypto.randomUUID(),
};

export function createApplicationContainer(
	dependencies: ApplicationDependencies = defaultDependencies,
): ApplicationContainer {
	const registrations = {
		applicationName: asValue(dependencies.applicationName),
		createRequestId: asValue(dependencies.createRequestId),
		healthService: asFunction(createHealthService).singleton(),
		requestContext: asFunction(createRequestContext).scoped(),
	} satisfies ApplicationRegistrations;

	return createContainer<ApplicationCradle>({
		injectionMode: InjectionMode.PROXY,
		strict: true,
	}).register(registrations);
}
