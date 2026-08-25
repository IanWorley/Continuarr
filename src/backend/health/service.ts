import { Context, Effect } from "effect";

const APPLICATION_CONFIG_TAG_ID = "continuarr/health/ApplicationConfig";
const HEALTHY_STATUS = "ok" as const;

export interface ApplicationConfig {
	readonly applicationName: string;
}

export const ApplicationConfig = Context.GenericTag<ApplicationConfig>(
	APPLICATION_CONFIG_TAG_ID,
);

export interface HealthReport {
	readonly application: string;
	readonly status: typeof HEALTHY_STATUS;
}

export function createHealthReport({
	applicationName,
}: ApplicationConfig): HealthReport {
	return {
		application: applicationName,
		status: HEALTHY_STATUS,
	};
}

export const getHealthReport = Effect.map(
	ApplicationConfig,
	createHealthReport,
);
