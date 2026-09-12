import { z } from "zod";
import { startPlexAuth } from "~/backend/shared/clients/plexclient";
import {
	findApplicationSetting,
	saveApplicationSetting,
} from "~/backend/shared/repo";

const PLEX_LOGIN_CLIENT_IDENTIFIER_KEY = "plex_login_client_identifier";

export async function startPlexLogin() {
	let setting = findApplicationSetting(PLEX_LOGIN_CLIENT_IDENTIFIER_KEY);

	if (!setting) {
		const clientIdentifier = crypto.randomUUID();
		setting = saveApplicationSetting(
			PLEX_LOGIN_CLIENT_IDENTIFIER_KEY,
			clientIdentifier,
		);
	}

	const canParse = z.string().safeParse(setting.value);
	if (!canParse.success) {
		throw new Error("Invalid plex identifier");
	}

	const result = await startPlexAuth(canParse.data);
	if (!result.success) {
		// throw 500 error
	}

	return result.data?.authorizationUrl;
}
