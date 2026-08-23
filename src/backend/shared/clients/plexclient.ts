import { PlexAPI } from "@parke.dev/plexjs/src/sdk/sdk.js";
import { plexOauthSchema } from "~/backend/shared/clients/model";

const PLEX_PRODUCT = "Continuarr";
const PLEX_PLATFORM = "server";
const PLEX_VERSION = "1.0.0";

const globalForPlex = globalThis as typeof globalThis & {
	plexClients?: Map<string, PlexAPI>;
};

function getPlexClients() {
	if (!globalForPlex.plexClients) {
		globalForPlex.plexClients = new Map();
	}

	return globalForPlex.plexClients;
}

function plexClientKey(clientIdentifier: string, token?: string) {
	return `${clientIdentifier}:${token ?? ""}`;
}

export function generatePlexClient(clientIdentifier: string, token?: string) {
	const clients = getPlexClients();
	const key = plexClientKey(clientIdentifier, token);
	const existing = clients.get(key);

	if (existing) {
		return existing;
	}

	const client = new PlexAPI({
		clientIdentifier,
		product: PLEX_PRODUCT,
		token,
		platform: PLEX_PLATFORM,
		version: PLEX_VERSION,
	});
	clients.set(key, client);
	return client;
}

export async function startPlexAuth(clientIdentifier: string, token?: string) {
	const client = generatePlexClient(clientIdentifier, token);
	const pin = await client.authentication.createOAuthPin(
		{
			clientIdentifier,
		},
		{},
	);

	if (!pin.id || !pin.code) {
		return plexOauthSchema.parse({
			success: false,
			data: null,
		});
	}

	const params = new URLSearchParams({
		clientID: clientIdentifier,
		code: pin.code,
		"context[device][product]": PLEX_PRODUCT,
		"context[device][version]": PLEX_VERSION,
		"context[device][platform]": PLEX_PLATFORM,
		"context[device][device]": PLEX_PLATFORM,
		"context[device][deviceName]": PLEX_PRODUCT,
	});

	const authorizationUrl = `https://app.plex.tv/auth/#!?${params}`;

	return {
		success: true,
		data: {
			code: pin.code,
			expiresAt: pin.expiresAt,
			token: pin.authToken,
			expiresIn: pin.expiresIn,
			authorizationUrl: authorizationUrl,
		},
	};
}
