import { eq } from "drizzle-orm";
import { exportJWK, generateKeyPair, type JWK } from "jose";
import {
	PLEX_JWK_PRIVATE_KEY,
	PLEX_JWK_PUBLIC_KEY,
} from "~/backend/shared/ApplicationSettingsConstants";
import { getDatabase } from "~/db/database";
import { type ApplicationSetting, applicationSettings } from "~/db/schema";

const PLEX_JWK_ALG = "Ed25519";

export type PlexJwkPair = {
	publicJwk: JWK;
	privateJwk: JWK;
};

function findApplicationSetting(key: string): ApplicationSetting | null {
	const { db } = getDatabase();
	const result = db
		.select()
		.from(applicationSettings)
		.where(eq(applicationSettings.key, key))
		.limit(1)
		.get();

	if (!result) {
		return null;
	}

	return result;
}

function saveApplicationSetting(key: string, value: string) {
	const { db } = getDatabase();
	db.insert(applicationSettings)
		.values({ key, value })
		.onConflictDoUpdate({
			target: [applicationSettings.key],
			set: { value: value },
		});
}

async function generatePlexJWK(): Promise<PlexJwkPair> {
	const { publicKey, privateKey } = await generateKeyPair(PLEX_JWK_ALG, {
		extractable: true,
	});
	const kid = crypto.randomUUID();
	const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: PLEX_JWK_ALG };
	const privateJwk = {
		...(await exportJWK(privateKey)),
		kid,
		alg: PLEX_JWK_ALG,
	};

	saveApplicationSetting(PLEX_JWK_PUBLIC_KEY, JSON.stringify(publicJwk));
	saveApplicationSetting(PLEX_JWK_PRIVATE_KEY, JSON.stringify(privateJwk));

	return { publicJwk, privateJwk };
}

async function getPlexJWK(): Promise<PlexJwkPair> {
	const publicKey = findApplicationSetting(PLEX_JWK_PUBLIC_KEY)?.value;
	const privateKey = findApplicationSetting(PLEX_JWK_PRIVATE_KEY)?.value;
	if (!publicKey || !privateKey) {
		throw new Error("Plex JWK not found. Please generate a new one.");
	}

	return {
		publicJwk: JSON.parse(publicKey) as JWK,
		privateJwk: JSON.parse(privateKey) as JWK,
	};
}

async function getOrCreatePlexJWK(): Promise<PlexJwkPair> {
	const publicKey = findApplicationSetting(PLEX_JWK_PUBLIC_KEY)?.value;
	const privateKey = findApplicationSetting(PLEX_JWK_PRIVATE_KEY)?.value;
	if (publicKey && privateKey) {
		return {
			publicJwk: JSON.parse(publicKey) as JWK,
			privateJwk: JSON.parse(privateKey) as JWK,
		};
	}

	return generatePlexJWK();
}

export {
	findApplicationSetting,
	generatePlexJWK,
	getOrCreatePlexJWK,
	getPlexJWK,
	saveApplicationSetting,
};
