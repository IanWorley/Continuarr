import { z } from "zod";

const PLEX_LOGIN_CLIENT_IDENTIFIER_KEY = "plex_login_client_identifier";

export interface PlexAuthStartResult {
	data: { authorizationUrl: string } | null;
}

export interface StartPlexLoginDependencies {
	findApplicationSetting: (key: string) => { value: string } | null;
	saveApplicationSetting: (key: string, value: string) => void;
	createClientIdentifier: () => string;
	startPlexAuth: (clientIdentifier: string) => Promise<PlexAuthStartResult>;
}

export function createStartPlexLogin(dependencies: StartPlexLoginDependencies) {
	return async function startPlexLogin() {
		const setting = dependencies.findApplicationSetting(
			PLEX_LOGIN_CLIENT_IDENTIFIER_KEY,
		);
		const plexIdentifier =
			setting?.value ?? dependencies.createClientIdentifier();

		if (!setting) {
			dependencies.saveApplicationSetting(
				PLEX_LOGIN_CLIENT_IDENTIFIER_KEY,
				plexIdentifier,
			);
		}

		const canParse = z.string().safeParse(plexIdentifier);
		if (!canParse.success) {
			throw new Error("Invalid plex identifier");
		}

		const result = await dependencies.startPlexAuth(canParse.data);
		return result.data?.authorizationUrl;
	};
}

export type StartPlexLogin = ReturnType<typeof createStartPlexLogin>;
