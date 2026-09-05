/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import { generateJwkPair } from "~/backend/auth/plex/jwk";

describe("Plex JWK generation", () => {
	it("generates an Ed25519 public and private key pair", async () => {
		const { privateJwk, publicJwk } = await generateJwkPair();

		expect(publicJwk).toMatchObject({
			alg: "EdDSA",
			crv: "Ed25519",
			kty: "OKP",
		});
		expect(privateJwk.kid).toBe(publicJwk.kid);
		expect(privateJwk.d).not.toBeEmpty();
	});
});
