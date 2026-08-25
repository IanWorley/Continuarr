import { z } from "zod";
import { PLEX_CALLBACK_URL } from "~/backend/auth/plex/endpoints";
import { PLEX_LOGIN_CLIENT_IDENTIFIER_KEY } from "~/backend/shared/ApplicationSettingsConstants";
import { startPlexAuth } from "~/backend/shared/clients/plexclient";
import {
	findApplicationSetting,
	getOrCreatePlexJWK,
	saveApplicationSetting,
} from "~/backend/shared/repo";

function getOrCreatePlexClientIdentifier() {
	const existing = findApplicationSetting(
		PLEX_LOGIN_CLIENT_IDENTIFIER_KEY,
	)?.value;
	if (existing) {
		return existing;
	}

	const clientIdentifier = crypto.randomUUID();
	saveApplicationSetting(PLEX_LOGIN_CLIENT_IDENTIFIER_KEY, clientIdentifier);
	return clientIdentifier;
}

export async function startPlexLogin(forwardUrl: string) {
	const plexIdentifier = getOrCreatePlexClientIdentifier();
	const canParse = z.string().safeParse(plexIdentifier);
	if (!canParse.success) {
		throw new Error("Invalid plex identifier");
	}

	const { publicJwk } = await getOrCreatePlexJWK();
	const result = await startPlexAuth(
		canParse.data,
		forwardUrl + PLEX_CALLBACK_URL,
		publicJwk,
	);
	if (!result.success || !result.data?.authorizationUrl) {
		console.error(result);
		throw new Error("Unable to start Plex login");
	}

	return result.data;
}

export async function handlePlexCallback(req: Request) {
	console.dir(req);
	return req;
}
