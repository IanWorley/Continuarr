import { secretStorage } from "~/backend/secrets/storage.server";
import { getOrCreateApplicationSetting } from "~/backend/shared/repo";
import { createJellyfinProvider } from "./jellyfin";
import { createPlexProvider } from "./plex";
import { createMediaRepository } from "./repo";
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
		const service = createMediaService({
			repo: createMediaRepository(),
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
				"Automatic sync could not run. Check database availability.",
			);
		});
	}, SCHEDULER_TICK_MS);
	timer.unref();
}
