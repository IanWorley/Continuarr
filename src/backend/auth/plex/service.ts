import {
	LOGIN_TTL_MS,
	PLEX_CALLBACK_PATH,
	SESSION_TTL_MS,
} from "~/backend/auth/plex/constants";
import { generateJwkPair } from "~/backend/auth/plex/jwk";
import * as repository from "~/backend/auth/plex/repo";
import {
	credentialKey,
	encryptCredentials,
	hashSecret,
	randomSecret,
} from "~/backend/auth/plex/secrets";
import * as plex from "~/backend/shared/clients/plexclient";

export class PlexLoginError extends Error {}

export function createPlexLoginService(repo = repository, client = plex) {
	return {
		async start(origin: string, browserSecret: string) {
			await credentialKey();
			const clientIdentifier = crypto.randomUUID();
			const pin = await client.createPlexPin(clientIdentifier);
			const state = crypto.randomUUID();
			const expiresAt = Math.min(
				Date.parse(pin.expiresAt),
				Date.now() + LOGIN_TTL_MS,
			);
			if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
				throw new PlexLoginError("Plex login expired");
			}
			repo.saveLogin({
				state,
				browserHash: hashSecret(browserSecret),
				clientIdentifier,
				pinId: pin.id,
				expiresAt,
			});
			const forwardUrl = new URL(PLEX_CALLBACK_PATH, origin);
			forwardUrl.searchParams.set("state", state);
			return {
				authorizationUrl: client.buildPlexAuthorizationUrl(
					clientIdentifier,
					pin.code,
					forwardUrl.toString(),
				),
				expiresAt: new Date(expiresAt).toISOString(),
			};
		},
		async complete(state: string, browserSecret: string) {
			const key = await credentialKey();
			const login = repo.takeLogin(state, hashSecret(browserSecret));
			if (!login)
				throw new PlexLoginError(
					"Plex login expired or belongs to another browser",
				);
			const pin = await client.getPlexPin(login.pinId, login.clientIdentifier);
			if (pin.id !== login.pinId || Date.parse(pin.expiresAt) <= Date.now()) {
				throw new PlexLoginError("Plex login expired");
			}
			if (!pin.authToken) {
				repo.saveLogin(login);
				return { status: "pending" as const };
			}
			// Plex's authenticated account response is the source of identity.
			const account = await client.getPlexAccount(
				login.clientIdentifier,
				pin.authToken,
			);
			const pair = await generateJwkPair();
			const device = await client.registerPlexJwk(
				login.clientIdentifier,
				pin.authToken,
				pair.publicJwk,
			);
			const id = repo.findUser(account.id)?.id ?? crypto.randomUUID();
			const displayName = account.friendlyName || account.title;
			const encryptedCredentials = await encryptCredentials(
				key,
				id,
				JSON.stringify({
					authToken: device.authToken,
					jwt: device.jwt,
					...pair,
				}),
			);
			const sessionToken = randomSecret();
			repo.saveAuthenticatedUser(
				{ id, plexId: account.id, displayName },
				{
					userId: id,
					clientIdentifier: login.clientIdentifier,
					encryptedCredentials,
				},
				{
					userId: id,
					tokenHash: hashSecret(sessionToken),
					expiresAt: Date.now() + SESSION_TTL_MS,
				},
			);
			return {
				status: "authenticated" as const,
				user: { displayName },
				sessionToken,
			};
		},
	};
}

export const plexLoginService = createPlexLoginService();
