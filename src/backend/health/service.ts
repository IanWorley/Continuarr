const HEALTHY_STATUS = "ok" as const;

interface HealthServiceDependencies {
	applicationName: string;
}

export interface HealthReport {
	application: string;
	status: typeof HEALTHY_STATUS;
}

export interface HealthService {
	getReport: () => HealthReport;
}

export function createHealthService({
	applicationName,
}: HealthServiceDependencies): HealthService {
	return {
		getReport: () => ({
			application: applicationName,
			status: HEALTHY_STATUS,
		}),
	};
}
