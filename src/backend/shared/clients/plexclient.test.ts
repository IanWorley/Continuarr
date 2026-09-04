/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import { generateJwkPair } from "~/backend/auth/plex/jwk";
import {
	buildPlexAuthorizationUrl,
	createPlexPin,
	registerPlexJwk,
} from "~/backend/shared/clients/plexclient";

const CLIENT_IDENTIFIER = "4c83fb87-c9ff-4fb4-8850-4ce39dc0c031";
const PLEX_TOKEN = "plex-token";
const PIN_CODE = "ABCD";
const PIN_ID = 1234;
const PIN_EXPIRATION = "2026-09-04T02:00:00.000Z";
const FORWARD_URL = "http://localhost:3000/plex?state=signed-state";

describe("Plex authentication client", () => {
	it("requests a strong OAuth PIN", async () => {
		let requestUrl: URL | undefined;
		let requestInit: RequestInit | undefined;
		const fetcher = async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			requestUrl = new URL(input.toString());
			requestInit = init;
			return Response.json(
				{ code: PIN_CODE, expiresAt: PIN_EXPIRATION, id: PIN_ID },
				{ status: 201 },
			);
		};

		const pin = await createPlexPin(CLIENT_IDENTIFIER, fetcher);

		expect(pin.id).toBe(PIN_ID);
		expect(requestUrl?.searchParams.get("strong")).toBe("true");
		expect(requestInit?.method).toBe("POST");
		expect(
			new Headers(requestInit?.headers).get("X-Plex-Client-Identifier"),
		).toBe(CLIENT_IDENTIFIER);
	});

	it("builds an authorization URL with a callback", () => {
		const authorizationUrl = new URL(
			buildPlexAuthorizationUrl(CLIENT_IDENTIFIER, PIN_CODE, FORWARD_URL),
		);
		const authorizationParams = new URLSearchParams(
			authorizationUrl.hash.slice("#!?".length),
		);

		expect(authorizationUrl.origin).toBe("https://app.plex.tv");
		expect(authorizationParams.get("clientID")).toBe(CLIENT_IDENTIFIER);
		expect(authorizationParams.get("forwardUrl")).toBe(FORWARD_URL);
	});

	it("registers only the public JWK as a strong device", async () => {
		const { publicJwk } = await generateJwkPair();
		let requestInit: RequestInit | undefined;
		const fetcher = async (
			_input: string | URL | Request,
			init?: RequestInit,
		) => {
			requestInit = init;
			return Response.json({
				authToken: PLEX_TOKEN,
				jwt: "header.body.signature",
			});
		};

		await registerPlexJwk(CLIENT_IDENTIFIER, PLEX_TOKEN, publicJwk, fetcher);

		const body = JSON.parse(String(requestInit?.body));
		expect(body).toEqual({
			jwk: {
				crv: publicJwk.crv,
				kid: publicJwk.kid,
				kty: publicJwk.kty,
				x: publicJwk.x,
			},
			strong: true,
		});
		expect(body.jwk.d).toBeUndefined();
		expect(new Headers(requestInit?.headers).get("X-Plex-Token")).toBe(
			PLEX_TOKEN,
		);
	});
});
