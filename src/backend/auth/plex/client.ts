export interface PlexAuthStartResult {
	data: { authorizationUrl: string } | null;
}

export interface PlexLoginClientDependencies {
	startPlexAuth: (clientIdentifier: string) => Promise<PlexAuthStartResult>;
}

export interface PlexLoginClient {
	startAuth: (clientIdentifier: string) => Promise<PlexAuthStartResult>;
}

export function createPlexLoginClient(
	dependencies: PlexLoginClientDependencies,
): PlexLoginClient {
	return {
		startAuth: dependencies.startPlexAuth,
	};
}
