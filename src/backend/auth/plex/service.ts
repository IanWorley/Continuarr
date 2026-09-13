import { randomBytes, randomUUID } from "node:crypto";
import type { AdministratorService } from "~/backend/admin/service";
import {
	createPlexPinClient,
	MILLISECONDS_PER_SECOND,
	PlexUnavailableError,
	plexAuthorizationUrl,
} from "~/backend/auth/plex/client";
import { createPlexAttemptRepository } from "~/backend/auth/plex/repo";

const STATE_BYTES = 32;
export class AuthorizationSessionError extends Error {
	constructor() {
		super("Sign in to Continuarr and start authorization again.");
	}
}

export function createPlexAuthorizationService(
	repository = createPlexAttemptRepository(),
	createPin = createPlexPinClient(),
	now = () => Math.floor(Date.now() / MILLISECONDS_PER_SECOND),
) {
	return {
		async start(request: Request, administrator: AdministratorService) {
			const sessionHash = administrator.activeSessionHash(request);
			if (!sessionHash) throw new AuthorizationSessionError();
			const state = randomBytes(STATE_BYTES).toString("hex");
			const clientIdentifier = randomUUID();
			repository.start(state, sessionHash, clientIdentifier, now());
			let pin: Awaited<ReturnType<typeof createPin>>;
			let expiresAt: number;
			try {
				pin = await createPin(clientIdentifier);
				expiresAt = Math.floor(
					Date.parse(pin.expiresAt) / MILLISECONDS_PER_SECOND,
				);
				if (expiresAt <= now()) throw new PlexUnavailableError();
			} catch {
				repository.fail(state, "plex_unavailable", now());
				throw new PlexUnavailableError();
			}
			if (!repository.ready(state, sessionHash, pin.id, expiresAt, now())) {
				repository.fail(state, "session_ended", now());
				throw new AuthorizationSessionError();
			}
			const returnUrl = new URL("/plex/", request.url);
			returnUrl.searchParams.set("state", state);
			return {
				authorizationUrl: plexAuthorizationUrl(
					clientIdentifier,
					pin.code,
					returnUrl,
				),
				expiresAt: new Date(expiresAt * MILLISECONDS_PER_SECOND).toISOString(),
			};
		},
	};
}
export type PlexAuthorizationService = ReturnType<
	typeof createPlexAuthorizationService
>;
