import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type createSecretStorage, Secret } from "~/backend/secrets/storage";
import {
	DEFAULT_USER_POLL_MINUTES,
	MAX_USER_POLL_MINUTES,
	MILLISECONDS_PER_MINUTE,
	MIN_USER_POLL_MINUTES,
} from "./constants";
import {
	type JellyfinProvider,
	type ManualMatch,
	MediaError,
	type PlexIdentity,
	type PlexPin,
	type PlexProvider,
	type PlexServer,
	type PlexUserOption,
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
	identity: Pick<PlexIdentity, "userId" | "name">;
	servers: PlexServer[];
	expiresAt: number;
};
const storedUserSummary = z.object({
	Policy: z.object({ IsAdministrator: z.boolean().optional() }).nullish(),
	LastActivityDate: z.string().nullish(),
	LastLoginDate: z.string().nullish(),
});
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
	const refreshes = new Map<
		string,
		Promise<{
			kind: "updated" | "superseded" | "failed";
			importedCount?: number;
			message?: string;
		}>
	>();
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
	async function plexDirectory(stored: Awaited<ReturnType<typeof account>>) {
		const token = secrets.decrypt(stored.id, stored.token);
		const [homeResult, sharedResult] = await Promise.allSettled([
			plex.homeUsers(token),
			plex.sharedUsers(token),
		]);
		const issues: string[] = [];
		if (homeResult.status === "rejected")
			issues.push("Could not load Plex Home users. Try again.");
		if (sharedResult.status === "rejected")
			issues.push("Could not load shared Plex users. Try again.");
		else issues.push(...sharedResult.value.issues);
		const users: PlexUserOption[] = [
			{ kind: "owner", id: stored.userId, name: stored.name },
		];
		const seen = new Set([stored.userId]);
		for (const user of homeResult.status === "fulfilled"
			? homeResult.value
			: []) {
			if (seen.has(user.id)) continue;
			users.push({ kind: "home", ...user });
			seen.add(user.id);
		}
		const shared =
			homeResult.status === "fulfilled" && sharedResult.status === "fulfilled"
				? sharedResult.value.users
				: [];
		for (const user of shared) {
			if (seen.has(user.id)) continue;
			users.push({ kind: "shared", id: user.id, name: user.name });
			seen.add(user.id);
		}
		return { users, shared, issues, token };
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
		if (j.presence !== "present" || j.disabled || !j.connectionId)
			throw new MediaError(
				"This Jellyfin user is missing, disabled, or awaiting refresh.",
			);
		const server = await repo.jellyfinServer(j.connectionId);
		if (!server) throw new MediaError("Reconnect the Jellyfin server.");
		const plexAccess = { url: p.url, token: secrets.decrypt(p.id, p.token) };
		const jellyfinAccess = {
			url: server.url,
			userId: j.userId,
			token: secrets.decrypt(server.id, server.token),
		};
		await plex.verifyServer(plexAccess, p.serverId);
		const [plexItems, jellyfinItems] = await Promise.all([
			plex.items(plexAccess),
			jellyfin.items(jellyfinAccess),
		]);
		return {
			plexAccess,
			jellyfinAccess,
			plex: plexItems,
			jellyfin: jellyfinItems,
			plan: planWatchedUnion({
				plex: plexItems,
				jellyfin: jellyfinItems,
				manualMatches: await repo.manualMatches(id),
			}),
		};
	}
	const service = {
		async jellyfinDirectory() {
			const [servers, users, pairings] = await Promise.all([
				repo.jellyfinServers(),
				repo.jellyfinProfiles(),
				repo.pairings(),
			]);
			return {
				servers: servers.map(
					({
						id,
						externalId,
						name,
						url,
						revision,
						pollEnabled,
						intervalMinutes,
						nextAttemptAt,
						lastAttemptAt,
						lastSuccessAt,
						lastError,
					}) => ({
						id,
						externalId,
						name,
						url,
						revision,
						pollEnabled,
						intervalMinutes,
						nextAttemptAt,
						lastAttemptAt,
						lastSuccessAt,
						lastError,
					}),
				),
				users: users.map((user) => {
					const summary = storedUserSummary.safeParse(user.userDetails);
					return {
						id: user.id,
						userId: user.userId,
						name: user.name,
						serverId: user.connectionId,
						presence: user.presence,
						disabled: user.disabled,
						userDetails: user.userDetails,
						administrator: summary.success
							? (summary.data.Policy?.IsAdministrator ?? false)
							: false,
						lastActivityDate: summary.success
							? (summary.data.LastActivityDate ?? null)
							: null,
						lastLoginDate: summary.success
							? (summary.data.LastLoginDate ?? null)
							: null,
						pairingId:
							pairings.find((pair) => pair.jellyfinProfileId === user.id)?.id ??
							null,
					};
				}),
			};
		},
		async importJellyfin(
			input:
				| { kind: "new"; url: string; apiKey: string }
				| {
						kind: "replace";
						id: string;
						revision: number;
						url: string;
						apiKey: string;
				  },
		) {
			const url = serverUrl(input.url);
			const directory = await jellyfin.directory({
				url,
				token: new Secret(input.apiKey),
			});
			return withConnectionWrite(async () => {
				ensureIdle();
				if (input.kind === "new") {
					if (
						(await repo.jellyfinServers()).some(
							(server) => server.externalId === directory.server.id,
						)
					)
						throw new MediaError(
							"This Jellyfin server is already connected. Replace its key instead.",
							409,
						);
					const id = randomUUID();
					await repo.addJellyfinServer(
						{
							id,
							externalId: directory.server.id,
							name: directory.server.name,
							url,
							token: secrets.encrypt(id, new Secret(input.apiKey)),
							intervalMinutes: DEFAULT_USER_POLL_MINUTES,
							nextAttemptAt:
								now() + DEFAULT_USER_POLL_MINUTES * MILLISECONDS_PER_MINUTE,
						},
						directory.users,
						now(),
					);
					return { id };
				}
				const existing = await repo.jellyfinServer(input.id);
				if (!existing) throw new MediaError("Jellyfin server not found.", 404);
				if (directory.server.id !== existing.externalId)
					throw new MediaError(
						"The Jellyfin URL points to a different server.",
						409,
					);
				const changed = await repo.replaceJellyfinServer(
					input.id,
					input.revision,
					{
						url,
						name: directory.server.name,
						token: secrets.encrypt(input.id, new Secret(input.apiKey)),
					},
					directory.users,
					now(),
				);
				if (!changed)
					throw new MediaError(
						"The Jellyfin connection changed. Reload and try again.",
						409,
					);
				return { id: input.id };
			});
		},
		async refreshJellyfinUsers(id: string) {
			const active = refreshes.get(id);
			if (active) return active;
			const work = (async () => {
				const claim = await repo.claimJellyfinRefresh(id, now());
				if (!claim) throw new MediaError("Jellyfin server not found.", 404);
				try {
					const directory = await jellyfin.directory({
						url: claim.url,
						token: secrets.decrypt(claim.id, claim.token),
					});
					if (directory.server.id !== claim.externalId)
						throw new MediaError(
							"The saved Jellyfin URL points to a different server.",
							409,
						);
					const updated = await repo.finishJellyfinRefresh(
						id,
						claim.revision,
						directory.users,
						now(),
						directory.server.name,
					);
					return updated
						? {
								kind: "updated" as const,
								importedCount: directory.users.length,
							}
						: { kind: "superseded" as const };
				} catch (error) {
					const message =
						error instanceof MediaError
							? error.message
							: "Could not refresh Jellyfin users. Check the server and API key.";
					const saved = await repo.failJellyfinRefresh(
						id,
						claim.revision,
						message,
					);
					return saved
						? { kind: "failed" as const, message }
						: { kind: "superseded" as const };
				}
			})();
			refreshes.set(id, work);
			try {
				return await work;
			} finally {
				refreshes.delete(id);
			}
		},
		async configureJellyfinPolling(
			id: string,
			enabled: boolean,
			intervalMinutes: number,
		) {
			if (
				!Number.isInteger(intervalMinutes) ||
				intervalMinutes < MIN_USER_POLL_MINUTES ||
				intervalMinutes > MAX_USER_POLL_MINUTES
			)
				throw new MediaError(
					"Choose a polling interval from 1 to 1440 minutes.",
				);
			const server = await repo.configureJellyfinPolling(
				id,
				enabled,
				intervalMinutes,
				now(),
			);
			if (!server) throw new MediaError("Jellyfin server not found.", 404);
			return {
				enabled: server.pollEnabled,
				intervalMinutes: server.intervalMinutes,
			};
		},
		async library(id: string) {
			const { plex, jellyfin } = await snapshot(id);
			return { plex, jellyfin, matches: await repo.manualMatches(id) };
		},
		async removeManualMatch(input: ManualMatch) {
			await pairing(input.pairingId);
			return withConnectionWrite(async () => {
				ensureIdle();
				await repo.removeManualMatch(input);
				return { removed: true };
			});
		},
		async saveManualMatch(input: ManualMatch) {
			ensureIdle();
			const library = await snapshot(input.pairingId);
			const p = library.plex.find((item) => item.id === input.plexItemId);
			const j = library.jellyfin.find(
				(item) => item.id === input.jellyfinItemId,
			);
			if (!p || !j)
				throw new MediaError(
					"An item is no longer available. Reload both libraries and select again.",
					404,
				);
			if (p.kind !== j.kind)
				throw new MediaError(
					"Match movies with movies, or episodes with episodes.",
				);
			return withConnectionWrite(async () => {
				ensureIdle();
				const inserted = await repo.addManualMatch(input);
				if (inserted) return inserted;
				const existing = (await repo.manualMatches(input.pairingId)).find(
					(match) =>
						match.plexItemId === input.plexItemId &&
						match.jellyfinItemId === input.jellyfinItemId,
				);
				if (existing) return existing;
				throw new MediaError(
					"One of these items already has a manual match. Select an unmatched item.",
					409,
				);
			});
		},
		async state() {
			const [
				accounts,
				activePlexAccountId,
				plexProfiles,
				jellyfinProfiles,
				jellyfinServers,
				pairings,
				runs,
			] = await Promise.all([
				repo.accounts(),
				repo.activePlexAccountId(),
				repo.plexProfiles(),
				repo.jellyfinProfiles(),
				repo.jellyfinServers(),
				repo.pairings(),
				repo.runs(),
			]);
			return {
				activePlexAccountId:
					activePlexAccountId ??
					(accounts.length === 1 ? accounts[0].id : null),
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
					({
						id,
						userId,
						name,
						serverId,
						url,
						connectionId,
						presence,
						disabled,
					}) => ({
						id,
						userId,
						name,
						serverId,
						url:
							jellyfinServers.find((server) => server.id === connectionId)
								?.url ?? url,
						connectionId,
						presence,
						disabled,
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
				await repo.saveActivePlexAccountId(id);
				return id;
			});
			attempt.accountId = accountId;
			return { status: "linked" as const, accountId };
		},
		async plexUsers(id: string) {
			const stored = await account(id);
			const { users, issues } = await plexDirectory(stored);
			return { users, issues };
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
			const directory = await plexDirectory(stored);
			const selected = directory.users.find((user) => user.id === input.userId);
			if (!selected)
				throw new MediaError(
					directory.issues.length
						? `${directory.issues.join(" ")} Select the profile again.`
						: "Plex user not found. Reload the user list.",
				);
			let identity: Pick<PlexIdentity, "userId" | "name">;
			let servers: PlexServer[];
			switch (selected.kind) {
				case "owner":
					identity = { userId: stored.userId, name: stored.name };
					servers = await plex.servers(directory.token);
					break;
				case "home": {
					const switched = await plex.switchUser({
						token: directory.token,
						userId: selected.id,
						pin: input.pin,
					});
					if (switched.userId !== selected.id)
						throw new MediaError(
							"Plex returned a different profile. No connection was saved.",
							502,
						);
					identity = { userId: switched.userId, name: switched.name };
					servers = await plex.servers(switched.token);
					break;
				}
				case "shared": {
					const friend = directory.shared.find(
						(user) => user.id === selected.id,
					);
					if (!friend)
						throw new MediaError(
							"Plex shared user not found. Reload the user list.",
						);
					identity = { userId: friend.id, name: friend.name };
					servers = friend.servers;
					break;
				}
			}
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
			if (jellyfinProfile.presence !== "present" || jellyfinProfile.disabled)
				throw new MediaError(
					"Refresh this Jellyfin user before pairing. Missing or disabled users cannot be paired.",
					409,
				);
			ensureIdle();
			const result = await repo.addPairing({ id: randomUUID(), ...input });
			if (result.kind === "unavailable")
				throw new MediaError(
					"Refresh this Jellyfin user before pairing. Missing or disabled users cannot be paired.",
					409,
				);
			if (result.kind === "conflict")
				throw new MediaError(
					"Each profile can belong to only one pairing. This prevents merging different users' histories.",
					409,
				);
			return result.row;
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
			if (ticking) return;
			ticking = true;
			try {
				for (const server of await repo.dueJellyfinServers(now()))
					await service.refreshJellyfinUsers(server.id);
				if (running) return;
				for (const pair of await repo.pairings()) {
					const profile = await repo.jellyfinProfile(pair.jellyfinProfileId);
					if (
						pair.automatic &&
						profile?.presence === "present" &&
						!profile.disabled &&
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
			const summary = `${applied} updates completed. ${result.plan.matched} matched pairs; ${result.plan.unmatched} unmatched items; ${result.plan.ambiguous} ambiguous items skipped. ${result.plan.staleManualMatches ?? 0} unavailable manual matches skipped.`;
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
