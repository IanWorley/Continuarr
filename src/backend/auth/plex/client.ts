import { z } from "zod";

const PLEX_PINS_URL = "https://plex.tv/api/v2/pins";
const PLEX_PRODUCT = "Continuarr";
const PLEX_REQUEST_TIMEOUT_MS = 10_000;
export const MILLISECONDS_PER_SECOND = 1000;
export type PlexTransport = (request: Request) => Promise<Response>;

const pinSchema = z.object({
	id: z.number().int().positive().safe(),
	code: z.string().min(1),
	expiresAt: z.iso.datetime({ offset: true }),
});

export class PlexUnavailableError extends Error {
	constructor() {
		super("Unable to start Plex authorization. Please retry.");
	}
}

export function createPlexPinClient(transport: PlexTransport = fetch) {
	return async (clientIdentifier: string) => {
		try {
			const response = await transport(
				new Request(PLEX_PINS_URL, {
					method: "POST",
					redirect: "error",
					headers: {
						accept: "application/json",
						"content-type": "application/x-www-form-urlencoded",
						"X-Plex-Product": PLEX_PRODUCT,
						"X-Plex-Client-Identifier": clientIdentifier,
					},
					body: new URLSearchParams({ strong: "true" }),
					signal: AbortSignal.timeout(PLEX_REQUEST_TIMEOUT_MS),
				}),
			);
			if (!response.ok) throw new PlexUnavailableError();
			// Only validated PIN fields cross this boundary, even if Plex includes an auth token.
			return pinSchema.parse(await response.json());
		} catch {
			throw new PlexUnavailableError();
		}
	};
}

export function plexAuthorizationUrl(
	clientIdentifier: string,
	code: string,
	returnUrl: URL,
) {
	const params = new URLSearchParams({
		clientID: clientIdentifier,
		code,
		forwardUrl: returnUrl.href,
		"context[device][product]": PLEX_PRODUCT,
	});
	return `https://app.plex.tv/auth/#!?${params}`;
}
