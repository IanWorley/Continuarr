import type { PlexLoginClient } from "~/backend/auth/plex/client";
import type { PlexLoginRepository } from "~/backend/auth/plex/repo";

export interface PlexLoginServiceDependencies {
	repository: PlexLoginRepository;
	client: PlexLoginClient;
	createClientIdentifier: () => string;
}

export interface PlexLoginService {
	startLogin: () => Promise<string | undefined>;
}

export function createPlexLoginService(
	dependencies: PlexLoginServiceDependencies,
): PlexLoginService {
	return {
		startLogin: async () => {
			const storedIdentifier = dependencies.repository.findClientIdentifier();
			const plexIdentifier =
				storedIdentifier ?? dependencies.createClientIdentifier();

			if (storedIdentifier === null) {
				dependencies.repository.saveClientIdentifier(plexIdentifier);
			}

			const result = await dependencies.client.startAuth(plexIdentifier);
			return result.data?.authorizationUrl;
		},
	};
}
