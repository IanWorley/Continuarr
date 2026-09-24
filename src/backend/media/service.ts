import { randomUUID } from "node:crypto";
import type { createSecretStorage } from "~/backend/secrets/storage";
import {
	type JellyfinProvider,
	MediaError,
	type PlexIdentity,
	type PlexPin,
	type PlexProvider,
	type PlexServer,
	serverUrl,
} from "./model";
import { planWatchedUnion } from "./plan";
import type { MediaRepository } from "./repo";

export const SYNC_INTERVAL_MS = 60 * 60 * 1000;
const SELECTION_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 2000;
const MILLISECONDS_PER_SECOND = 1000;
type PendingLogin = {
	pin: PlexPin;
	expiresAt: number;
	nextPollAt: number;
	accountId?: string;
};
type Selection = {
	accountId: string;
	identity: PlexIdentity;
	servers: PlexServer[];
	expiresAt: number;
};
export function createMediaService({
	repo,
	secrets,
	plex,
	jellyfin,
	now = Date.now,
}: {
	repo: MediaRepository;
	secrets: ReturnType<typeof createSecretStorage>;
	plex: PlexProvider;
	jellyfin: JellyfinProvider;
	now?: () => number;
}) {
	const logins = new Map<string, PendingLogin>();
	const selections = new Map<string, Selection>();
	let running = false;
	let ticking = false;
	let connectionWrites: Promise<void> = Promise.resolve();
	function withConnectionWrite<T>(write: () => Promise<T>): Promise<T> {
		const result = connectionWrites.then(write);
		connectionWrites = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
	function prune() {
		for (const [id, item] of logins)
			if (item.expiresAt <= now()) logins.delete(id);
		for (const [id, item] of selections)
			if (item.expiresAt <= now()) selections.delete(id);
	}
	async function account(id: string) {
		const result = await repo.account(id);
		if (!result) throw new MediaError("Plex account not found.", 404);
		return result;
	}
	async function pairing(id: string) {
		const result = await repo.pairing(id);
		if (!result) throw new MediaError("Pairing not found.", 404);
		return result;
	}
	function ensureIdle() {
		if (running)
			throw new MediaError(
				"A sync is already running. Wait for it to finish.",
				409,
			);
	}
	async function snapshot(id: string) {
		const pair = await pairing(id);
		const [p, j] = await Promise.all([
			repo.plexProfile(pair.plexProfileId),
			repo.jellyfinProfile(pair.jellyfinProfileId),
		]);
		if (!p || !j)
			throw new MediaError("Reconnect the profiles for this pairing.");
		const plexAccess = { url: p.url, token: secrets.decrypt(p.id, p.token) };
		const jellyfinAccess = {
			url: j.url,
			userId: j.userId,
			token: secrets.decrypt(j.id, j.token),
		};
		await plex.verifyServer(plexAccess, p.serverId);
		const [plexItems, jellyfinItems] = await Promise.all([
			plex.items(plexAccess),
			jellyfin.items(jellyfinAccess),
		]);
		return {
			plexAccess,
			jellyfinAccess,
			plan: planWatchedUnion({ plex: plexItems, jellyfin: jellyfinItems }),
		};
	}
	const service = {
		async state() {
			const [accounts, plexProfiles, jellyfinProfiles, pairings, runs] =
				await Promise.all([
					repo.accounts(),
					repo.plexProfiles(),
					repo.jellyfinProfiles(),
					repo.pairings(),
					repo.runs(),
				]);
			return {
				accounts: accounts.map(({ id, userId, name }) => ({
					id,
					userId,
					name,
				})),
				plexProfiles: plexProfiles.map(
					({ id, accountId, userId, name, serverId, serverName, url }) => ({
						id,
						accountId,
						userId,
						name,
						serverId,
						serverName,
						url,
					}),
				),
				jellyfinProfiles: jellyfinProfiles.map(
					({ id, userId, name, serverId, url }) => ({
						id,
						userId,
						name,
						serverId,
						url,
					}),
				),
				pairings,
				runs,
				running,
			};
		},
		async startLogin() {
			prune();
			if (logins.size >= MAX_PENDING_ATTEMPTS)
				throw new MediaError(
					"Too many pending Plex logins. Try again in a few minutes.",
					409,
				);
			const pin = await plex.startLogin();
			const id = randomUUID();
			const expiresAt = now() + pin.expiresIn * MILLISECONDS_PER_SECOND;
			logins.set(id, { pin, expiresAt, nextPollAt: 0 });
			return {
				id,
				authorizationUrl: pin.authorizationUrl,
				expiresAt,
				pollIntervalMs: POLL_INTERVAL_MS,
			};
		},
		async pollLogin(id: string) {
			prune();
			const attempt = logins.get(id);
			if (!attempt) return { status: "expired" as const };
			if (attempt.accountId)
				return { status: "linked" as const, accountId: attempt.accountId };
			if (attempt.nextPollAt > now()) return { status: "pending" as const };
			attempt.nextPollAt = now() + POLL_INTERVAL_MS;
			const identity = await plex.pollLogin(attempt.pin);
			if (!identity) return { status: "pending" as const };
			const accountId = await withConnectionWrite(async () => {
				ensureIdle();
				const existing = (await repo.accounts()).find(
					(item) => item.userId === identity.userId,
				);
				const id = existing?.id ?? randomUUID();
				await repo.saveAccount({
					id,
					userId: identity.userId,
					name: identity.name,
					token: secrets.encrypt(id, identity.token),
				});
				return id;
			});
			attempt.accountId = accountId;
			return { status: "linked" as const, accountId };
		},
		async homeUsers(id: string) {
			const stored = await account(id);
			const users = await plex.homeUsers(
				secrets.decrypt(stored.id, stored.token),
			);
			return users.some((user) => user.id === stored.userId)
				? users
				: [
						{ id: stored.userId, name: stored.name, protected: false },
						...users,
					];
		},
		async selectProfile(input: {
			accountId: string;
			userId: string;
			pin?: string;
		}) {
			prune();
			if (selections.size >= MAX_PENDING_ATTEMPTS)
				throw new MediaError(
					"Too many pending profile selections. Try again shortly.",
					409,
				);
			const stored = await account(input.accountId);
			const token = secrets.decrypt(stored.id, stored.token);
			const identity =
				input.userId === stored.userId
					? { userId: stored.userId, name: stored.name, token }
					: await plex.switchUser({
							token,
							userId: input.userId,
							pin: input.pin,
						});
			if (identity.userId !== input.userId)
				throw new MediaError(
					"Plex returned a different profile. No connection was saved.",
					502,
				);
			const servers = await plex.servers(identity.token);
			const id = randomUUID();
			selections.set(id, {
				accountId: stored.id,
				identity,
				servers,
				expiresAt: now() + SELECTION_TTL_MS,
			});
			return {
				id,
				servers: servers.map(({ id, name, connections }) => ({
					id,
					name,
					connections,
				})),
			};
		},
		async connectPlex(input: {
			selectionId: string;
			serverId: string;
			url: string;
		}) {
			ensureIdle();
			prune();
			const selection = selections.get(input.selectionId);
			if (!selection)
				throw new MediaError(
					"Profile selection expired. Select the Plex profile again.",
				);
			const server = selection.servers.find(
				(item) => item.id === input.serverId,
			);
			const url = serverUrl(input.url);
			if (
				!server?.connections.some((connection) => serverUrl(connection) === url)
			)
				throw new MediaError(
					"Choose a connection advertised by this Plex server.",
				);
			await plex.verifyServer({ url, token: server.token }, server.id);
			ensureIdle();
			const id = await withConnectionWrite(async () => {
				ensureIdle();
				const existing = (await repo.plexProfiles()).find(
					(item) =>
						item.userId === selection.identity.userId &&
						item.serverId === server.id,
				);
				const profileId = existing?.id ?? randomUUID();
				await repo.savePlexProfile({
					id: profileId,
					accountId: selection.accountId,
					userId: selection.identity.userId,
					name: selection.identity.name,
					serverId: server.id,
					serverName: server.name,
					url,
					token: secrets.encrypt(profileId, server.token),
				});
				return profileId;
			});
			selections.delete(input.selectionId);
			return { id };
		},
		async connectJellyfin(input: {
			url: string;
			username: string;
			password: string;
		}) {
			ensureIdle();
			const identity = await jellyfin.login({
				...input,
				url: serverUrl(input.url),
			});
			ensureIdle();
			const id = await withConnectionWrite(async () => {
				ensureIdle();
				const existing = (await repo.jellyfinProfiles()).find(
					(item) =>
						item.userId === identity.userId &&
						item.serverId === identity.serverId,
				);
				const profileId = existing?.id ?? randomUUID();
				await repo.saveJellyfinProfile({
					id: profileId,
					userId: identity.userId,
					name: identity.name,
					serverId: identity.serverId,
					url: identity.url,
					token: secrets.encrypt(profileId, identity.token),
				});
				return profileId;
			});
			return { id };
		},
		async addPairing(input: {
			plexProfileId: string;
			jellyfinProfileId: string;
		}) {
			ensureIdle();
			const [plexProfile, jellyfinProfile] = await Promise.all([
				repo.plexProfile(input.plexProfileId),
				repo.jellyfinProfile(input.jellyfinProfileId),
			]);
			if (!plexProfile || !jellyfinProfile)
				throw new MediaError("Select a saved Plex and Jellyfin profile.");
			ensureIdle();
			const result = await repo.addPairing({ id: randomUUID(), ...input });
			if (!result)
				throw new MediaError(
					"Each profile can belong to only one pairing. This prevents merging different users' histories.",
					409,
				);
			return result;
		},
		async automatic(id: string, enabled: boolean) {
			await pairing(id);
			await repo.automatic(id, enabled);
			return { enabled };
		},
		async preview(id: string) {
			ensureIdle();
			return (await snapshot(id)).plan;
		},
		async run(id: string) {
			ensureIdle();
			running = true;
			try {
				await connectionWrites;
				await pairing(id);
				return await executeRun(id);
			} finally {
				running = false;
			}
		},
		async tick() {
			if (running || ticking) return;
			ticking = true;
			try {
				for (const pair of await repo.pairings()) {
					if (
						pair.automatic &&
						now() - pair.lastAttemptAt >= SYNC_INTERVAL_MS
					) {
						if (running) return;
						await service.run(pair.id);
					}
				}
			} finally {
				ticking = false;
			}
		},
		recoverInterruptedRuns() {
			return repo.interruptRuns(now());
		},
	};
	async function executeRun(id: string) {
		const runId = randomUUID();
		let applied = 0;
		let planned = 0;
		let recorded = false;
		try {
			await repo.attempted(id, now());
			await repo.startRun({
				id: runId,
				pairingId: id,
				startedAt: now(),
				status: "running",
				summary: "Reading both libraries.",
			});
			recorded = true;
			const result = await snapshot(id);
			planned = result.plan.writes.length;
			await repo.updateRun(runId, {
				planned,
				summary: "Applying watched status.",
			});
			for (const write of result.plan.writes) {
				if (write.target === "plex")
					await plex.markWatched(result.plexAccess, write.itemId);
				else await jellyfin.markWatched(result.jellyfinAccess, write.itemId);
				applied++;
				await repo.updateRun(runId, { applied });
			}
			const summary = `${applied} updates completed. ${result.plan.matched} matched pairs; ${result.plan.unmatched} unmatched items; ${result.plan.ambiguous} ambiguous items skipped.`;
			await repo.updateRun(runId, {
				status: "completed",
				finishedAt: now(),
				summary,
			});
			return {
				id: runId,
				status: "completed" as const,
				applied,
				planned,
				summary,
			};
		} catch (error) {
			if (!recorded) throw error;
			const detail =
				error instanceof MediaError
					? error.message
					: "Unable to complete sync. Check the connections and try again.";
			const summary = `${applied} of ${planned} updates completed. ${detail} A retry reads current watched status first.`;
			await repo.updateRun(runId, {
				status: "failed",
				finishedAt: now(),
				applied,
				planned,
				summary,
			});
			return {
				id: runId,
				status: "failed" as const,
				applied,
				planned,
				summary,
			};
		}
	}
	return service;
}
export type MediaService = ReturnType<typeof createMediaService>;
