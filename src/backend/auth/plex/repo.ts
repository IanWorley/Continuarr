const PLEX_LOGIN_CLIENT_IDENTIFIER_KEY = "plex_login_client_identifier";

export interface PlexLoginRepositoryDependencies {
	findApplicationSetting: (key: string) => { value: string } | null;
	saveApplicationSetting: (key: string, value: string) => void;
}

export interface PlexLoginRepository {
	findClientIdentifier: () => string | null;
	saveClientIdentifier: (clientIdentifier: string) => void;
}

export function createPlexLoginRepository(
	dependencies: PlexLoginRepositoryDependencies,
): PlexLoginRepository {
	return {
		findClientIdentifier: () =>
			dependencies.findApplicationSetting(PLEX_LOGIN_CLIENT_IDENTIFIER_KEY)
				?.value ?? null,
		saveClientIdentifier: (clientIdentifier) =>
			dependencies.saveApplicationSetting(
				PLEX_LOGIN_CLIENT_IDENTIFIER_KEY,
				clientIdentifier,
			),
	};
}
