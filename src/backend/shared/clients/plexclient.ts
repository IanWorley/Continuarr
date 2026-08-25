import type { Jwk } from "@parke.dev/plexjs/src/models/shared/jwkregistrationrequest.js";
import { PlexAPI } from "@parke.dev/plexjs/src/sdk/sdk.js";
import type { JWK } from "jose";
import {
	type PlexOauth,
	plexOauthSchema,
} from "~/backend/shared/clients/model";

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

function toPlexJwk(publicJwk: JWK): Jwk {
	return {
		crv: publicJwk.crv,
		kid: publicJwk.kid,
		kty: publicJwk.kty,
		x: publicJwk.x,
	};
}

function generatePlexClient(clientIdentifier: string, token?: string) {
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

export async function startPlexAuth(
	clientIdentifier: string,
	publicJwk: JWK,
	token?: string,
): Promise<PlexOauth> {
	const plexJwk = toPlexJwk(publicJwk);
	if (!plexJwk.crv || !plexJwk.kid || !plexJwk.kty || !plexJwk.x) {
		return plexOauthSchema.parse({
			success: false,
			data: null,
		});
	}

	const client = generatePlexClient(clientIdentifier, token);

	if (token) {
		await client.authentication.registerDeviceJWK({
			jwkRegistrationRequest: {
				jwk: plexJwk,
				strong: true,
			},
		});
	}

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

	return plexOauthSchema.parse({
		success: true,
		data: {
			code: pin.code,
			expiresAt: pin.expiresAt,
			token: pin.authToken,
			expiresIn: pin.expiresIn,
			authorizationUrl: authorizationUrl,
		},
	});
}
