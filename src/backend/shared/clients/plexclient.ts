import type { PublicJwk } from "~/backend/auth/plex/jwk";
import {
	type PlexAccount,
	type PlexPin,
	plexAccountSchema,
	plexDeviceAuthSchema,
	plexPinSchema,
} from "~/backend/shared/clients/model";

const PLEX_API_URL = "https://plex.tv/api/v2";
const PLEX_CLIENTS_API_URL = "https://clients.plex.tv/api/v2";
const PLEX_ACCOUNT_URL = "https://plex.tv/users/account.json";
const PLEX_AUTHORIZATION_URL = "https://app.plex.tv/auth/#!?";
const PLEX_PRODUCT = "Continuarr";
const PLEX_PLATFORM = "server";
const PLEX_VERSION = "1.0.0";
const REQUEST_TIMEOUT_MS = 15_000;

function requestOptions(): RequestInit {
	return { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: "error" };
}

type Fetcher = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

function plexHeaders(clientIdentifier: string, token?: string): Headers {
	const headers = new Headers({
		Accept: "application/json",
		"X-Plex-Client-Identifier": clientIdentifier,
		"X-Plex-Device": PLEX_PLATFORM,
		"X-Plex-Device-Name": PLEX_PRODUCT,
		"X-Plex-Platform": PLEX_PLATFORM,
		"X-Plex-Product": PLEX_PRODUCT,
		"X-Plex-Version": PLEX_VERSION,
	});
	if (token) {
		headers.set("X-Plex-Token", token);
	}
	return headers;
}

async function readPlexResponse(response: Response): Promise<unknown> {
	if (!response.ok) {
		throw new Error(`Plex request failed with status ${response.status}`);
	}
	return response.json();
}

export async function createPlexPin(
	clientIdentifier: string,
	fetcher: Fetcher = fetch,
): Promise<PlexPin> {
	const url = new URL(`${PLEX_API_URL}/pins`);
	url.searchParams.set("strong", "true");
	const response = await fetcher(url, {
		...requestOptions(),
		headers: plexHeaders(clientIdentifier),
		method: "POST",
	});
	return plexPinSchema.parse(await readPlexResponse(response));
}

export async function getPlexPin(
	pinId: number,
	clientIdentifier: string,
	fetcher: Fetcher = fetch,
): Promise<PlexPin> {
	const response = await fetcher(`${PLEX_API_URL}/pins/${pinId}`, {
		...requestOptions(),
		headers: plexHeaders(clientIdentifier),
	});
	return plexPinSchema.parse(await readPlexResponse(response));
}

export function buildPlexAuthorizationUrl(
	clientIdentifier: string,
	code: string,
	forwardUrl: string,
): string {
	const params = new URLSearchParams({
		clientID: clientIdentifier,
		code,
		"context[device][device]": PLEX_PLATFORM,
		"context[device][deviceName]": PLEX_PRODUCT,
		"context[device][platform]": PLEX_PLATFORM,
		"context[device][product]": PLEX_PRODUCT,
		"context[device][version]": PLEX_VERSION,
		forwardUrl,
	});
	return `${PLEX_AUTHORIZATION_URL}${params}`;
}

export async function registerPlexJwk(
	clientIdentifier: string,
	token: string,
	publicJwk: PublicJwk,
	fetcher: Fetcher = fetch,
) {
	const headers = plexHeaders(clientIdentifier, token);
	headers.set("Content-Type", "application/json");
	const response = await fetcher(`${PLEX_CLIENTS_API_URL}/auth/jwk`, {
		...requestOptions(),
		body: JSON.stringify({
			jwk: {
				crv: publicJwk.crv,
				kid: publicJwk.kid,
				kty: publicJwk.kty,
				x: publicJwk.x,
			},
			strong: true,
		}),
		headers,
		method: "POST",
	});
	return plexDeviceAuthSchema.parse(await readPlexResponse(response));
}

export async function getPlexAccount(
	clientIdentifier: string,
	token: string,
	fetcher: Fetcher = fetch,
): Promise<PlexAccount> {
	const response = await fetcher(PLEX_ACCOUNT_URL, {
		...requestOptions(),
		headers: plexHeaders(clientIdentifier, token),
	});
	return plexAccountSchema.parse(await readPlexResponse(response));
}
