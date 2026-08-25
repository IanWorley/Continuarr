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
const PLEX_AUTHORIZATION_URL = "https://app.plex.tv/auth/#!?";

export function createPlexClient(
	clientIdentifier: string,
	token?: string,
): PlexAPI {
	return new PlexAPI({
		clientIdentifier,
		product: PLEX_PRODUCT,
		token,
		platform: PLEX_PLATFORM,
		version: PLEX_VERSION,
	});
}

function toPlexJwk(publicJwk: JWK): Jwk | null {
	const { crv, kid, kty, x } = publicJwk;
	if (!crv || !kid || !kty || !x) {
		return null;
	}
	return { crv, kid, kty, x };
}

function oauthFailure(): PlexOauth {
	return plexOauthSchema.parse({ success: false, data: null });
}

function registerDeviceJwk(client: PlexAPI, plexJwk: Jwk): Promise<unknown> {
	return client.authentication.registerDeviceJWK({
		jwkRegistrationRequest: {
			jwk: plexJwk,
			strong: true,
		},
	});
}

function buildAuthorizationUrl(clientIdentifier: string, code: string): string {
	const params = new URLSearchParams({
		clientID: clientIdentifier,
		code,
		"context[device][product]": PLEX_PRODUCT,
		"context[device][version]": PLEX_VERSION,
		"context[device][platform]": PLEX_PLATFORM,
		"context[device][device]": PLEX_PLATFORM,
		"context[device][deviceName]": PLEX_PRODUCT,
	});

	return `${PLEX_AUTHORIZATION_URL}${params}`;
}

export async function startPlexAuth(
	clientIdentifier: string,
	publicJwk: JWK,
	token?: string,
): Promise<PlexOauth> {
	const plexJwk = toPlexJwk(publicJwk);
	if (!plexJwk) {
		return oauthFailure();
	}

	const client = createPlexClient(clientIdentifier, token);

	if (token) {
		await registerDeviceJwk(client, plexJwk);
	}

	const pin = await client.authentication.createOAuthPin(
		{
			clientIdentifier,
		},
		{},
	);

	if (!pin.id || !pin.code) {
		return oauthFailure();
	}

	return plexOauthSchema.parse({
		success: true,
		data: {
			code: pin.code,
			expiresAt: pin.expiresAt,
			token: pin.authToken,
			expiresIn: pin.expiresIn,
			authorizationUrl: buildAuthorizationUrl(clientIdentifier, pin.code),
		},
	});
}
