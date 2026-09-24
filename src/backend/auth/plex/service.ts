import { z } from "zod";
import { startPlexAuth } from "~/backend/shared/clients/plexclient";
import { getOrCreateApplicationSetting } from "~/backend/shared/repo";

const PLEX_LOGIN_CLIENT_IDENTIFIER_KEY = "plex_login_client_identifier";

export async function startPlexLogin() {
	const setting = await getOrCreateApplicationSetting(
		PLEX_LOGIN_CLIENT_IDENTIFIER_KEY,
		crypto.randomUUID(),
	);

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
