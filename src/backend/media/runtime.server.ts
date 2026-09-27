import { secretStorage } from "~/backend/secrets/storage.server";
import { getOrCreateApplicationSetting } from "~/backend/shared/repo";
import { createJellyfinProvider } from "./jellyfin";
import { createPlexProvider } from "./plex";
import { createMediaRepository, JellyfinMigrationError } from "./repo";
import { createMediaService } from "./service";

const CLIENT_ID_KEY = "plex_login_client_identifier";
const SCHEDULER_TICK_MS = 60_000;
let servicePromise: Promise<ReturnType<typeof createMediaService>> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
export function getMediaService() {
	servicePromise ??= (async () => {
		const setting = await getOrCreateApplicationSetting(
			CLIENT_ID_KEY,
			crypto.randomUUID(),
		);
		const clientIdentifier = setting.value;
		const repo = createMediaRepository();
		await repo
			.backfillJellyfinServers(secretStorage)
			.catch((error: unknown) => {
				if (error instanceof JellyfinMigrationError)
					console.error(error.message);
				throw error;
			});
		await repo.backfillPlexServers();
		const service = createMediaService({
			repo,
			secrets: secretStorage,
			plex: createPlexProvider({ clientIdentifier }),
			jellyfin: createJellyfinProvider({ clientIdentifier }),
		});
		await service.recoverInterruptedRuns();
		return service;
	})().catch((error: unknown) => {
		servicePromise = undefined;
		throw error;
	});
	return servicePromise;
}
export async function startMediaScheduler() {
	if (timer) return;
	const service = await getMediaService();
	if (timer) return;
	timer = setInterval(() => {
		void service.tick().catch(() => {
			console.error(
				"Automatic media work could not run. Check database availability.",
			);
		});
	}, SCHEDULER_TICK_MS);
	timer.unref();
}
