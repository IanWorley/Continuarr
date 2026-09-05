import { z } from "zod";

const ED25519_ALGORITHM = "Ed25519";
const JWT_ALGORITHM = "EdDSA";

export const publicJwkSchema = z.object({
	alg: z.literal(JWT_ALGORITHM),
	crv: z.literal(ED25519_ALGORITHM),
	kid: z.string().min(1),
	kty: z.literal("OKP"),
	use: z.literal("sig"),
	x: z.string().min(1),
});

export const privateJwkSchema = publicJwkSchema.extend({
	d: z.string().min(1),
});

export type PublicJwk = z.infer<typeof publicJwkSchema>;
export type PrivateJwk = z.infer<typeof privateJwkSchema>;

export interface JwkPair {
	privateJwk: PrivateJwk;
	publicJwk: PublicJwk;
}

export async function generateJwkPair(): Promise<JwkPair> {
	const keys = (await crypto.subtle.generateKey(ED25519_ALGORITHM, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	const kid = crypto.randomUUID();
	const publicJwk = publicJwkSchema.parse({
		...(await crypto.subtle.exportKey("jwk", keys.publicKey)),
		alg: JWT_ALGORITHM,
		kid,
		use: "sig",
	});
	const privateJwk = privateJwkSchema.parse({
		...(await crypto.subtle.exportKey("jwk", keys.privateKey)),
		alg: JWT_ALGORITHM,
		kid,
		use: "sig",
	});

	return { privateJwk, publicJwk };
}
