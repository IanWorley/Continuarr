import { authenticationCreateOAuthPin } from "@parke.dev/plexjs/src/funcs/authenticationCreateOAuthPin.js";
import { PlexAPIError } from "@parke.dev/plexjs/src/models/errors/plexapierror.js";
import { createOAuthPinResponseFromJSON } from "@parke.dev/plexjs/src/models/operations/createoauthpin.js";
import type { Jwk } from "@parke.dev/plexjs/src/models/shared/jwkregistrationrequest.js";
import { PlexAPI } from "@parke.dev/plexjs/src/sdk/sdk.js";
import type { JWK } from "jose";
import type z from "zod";
import type { plexOauthSchema } from "~/backend/shared/clients/model";

const PLEX_PRODUCT = "Continuarr";
const PLEX_PLATFORM = "server";
const PLEX_VERSION = "1.0.0";
const PLEX_PIN_CREATED_STATUS = 201;

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

async function createPlexOAuthPin(client: PlexAPI, clientIdentifier: string) {
	const result = await authenticationCreateOAuthPin(
		client,
		{ clientIdentifier },
		{ clientIdentifier },
	);

	if (result.ok) {
		return result.value;
	}

	if (
		result.error instanceof PlexAPIError &&
		result.error.statusCode === PLEX_PIN_CREATED_STATUS
	) {
		const parsed = createOAuthPinResponseFromJSON(result.error.body);
		if (parsed.ok) {
			return parsed.value;
		}
	}

	throw result.error;
}

export async function startPlexAuth(
	clientIdentifier: string,
	forwardUrl: string,
	publicJwk: JWK,
	token?: string,
) {
	const plexJwk = toPlexJwk(publicJwk);
	if (!plexJwk.kty || !plexJwk.crv || !plexJwk.x || !plexJwk.kid) {
		const result: z.infer<typeof plexOauthSchema> = {
			success: false,
			data: null,
		};
		return result;
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

	const pin = await createPlexOAuthPin(client, clientIdentifier);

	if (!pin.id || !pin.code || !pin.expiresAt) {
		const result: z.infer<typeof plexOauthSchema> = {
			success: false,
			data: null,
		};
		return result;
	}

	const params = new URLSearchParams({
		clientID: clientIdentifier,
		code: pin.code,
		forwardUrl,
		"context[device][product]": PLEX_PRODUCT,
		"context[device][version]": PLEX_VERSION,
		"context[device][platform]": PLEX_PLATFORM,
		"context[device][device]": PLEX_PLATFORM,
		"context[device][deviceName]": PLEX_PRODUCT,
	});

	const authorizationUrl = `https://app.plex.tv/auth/#!?${params}`;

	const result: z.infer<typeof plexOauthSchema> = {
		success: true,
		data: {
			code: pin.code,
			expiresAt: pin.expiresAt,
			token: pin.authToken,
			expiresIn: pin.expiresIn,
			authorizationUrl: authorizationUrl,
		},
	};

	return result;
}
