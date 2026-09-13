import { PlexAPI } from "@parke.dev/plexjs/src/sdk/sdk.js";

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
