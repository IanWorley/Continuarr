import { z } from "zod";
import { startPlexAuth } from "~/backend/shared/clients/plexclient";
import {
	findApplicationSetting,
	saveApplicationSetting,
} from "~/backend/shared/repo";

const PLEX_LOGIN_CLIENT_IDENTIFIER_KEY = "plex_login_client_identifier";

export async function startPlexLogin() {
	let plexIdentifier = null;

	if (!findApplicationSetting(PLEX_LOGIN_CLIENT_IDENTIFIER_KEY)) {
		const clientIdentifier = crypto.randomUUID();
		saveApplicationSetting(PLEX_LOGIN_CLIENT_IDENTIFIER_KEY, clientIdentifier);
		plexIdentifier = clientIdentifier;
	} else {
		plexIdentifier = findApplicationSetting(
			PLEX_LOGIN_CLIENT_IDENTIFIER_KEY,
		)?.value;
	}

	const canParse = z.string().safeParse(plexIdentifier);
	if (!canParse.success) {
		throw new Error("Invalid plex identifier");
	}

	const result = await startPlexAuth(canParse.data);
	if (!result.success) {
		// throw 500 error
	}

	return result.data?.authorizationUrl;
}
