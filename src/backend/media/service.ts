import { randomUUID } from "node:crypto";
import type { createSecretStorage } from "~/backend/secrets/storage";
import {
	type JellyfinProvider,
	type JellyfinSource,
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
			const [
				accounts,
				activePlexAccountId,
				plexProfiles,
				jellyfinProfiles,
				pairings,
				runs,
			] = await Promise.all([
				repo.accounts(),
				repo.activePlexAccountId(),
				repo.plexProfiles(),
				repo.jellyfinProfiles(),
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
		async jellyfinUsers(input: { source: JellyfinSource }) {
			if (input.source.kind === "new")
				return jellyfin.users({
					url: serverUrl(input.source.url),
					apiKey: input.source.apiKey,
				});
			const stored = await repo.jellyfinProfile(input.source.profileId);
			if (!stored) throw new MediaError("Jellyfin profile not found.", 404);
			const apiKey = secrets.decrypt(stored.id, stored.token).reveal();
			const server = await jellyfin.server({
				url: stored.url,
				apiKey,
			});
			if (server.id !== stored.serverId)
				throw new MediaError(
					"The saved Jellyfin URL points to a different server.",
					409,
				);
			return jellyfin.users({ url: stored.url, apiKey });
		},
		async connectJellyfin(input: { source: JellyfinSource; userId: string }) {
			ensureIdle();
			let source:
				| { kind: "new"; url: string; apiKey: string }
				| {
						kind: "saved";
						profileId: string;
						url: string;
						apiKey: string;
						serverId: string;
				  };
			if (input.source.kind === "new") {
				source = {
					kind: "new",
					url: serverUrl(input.source.url),
					apiKey: input.source.apiKey,
				};
			} else {
				const stored = await repo.jellyfinProfile(input.source.profileId);
				if (!stored) throw new MediaError("Jellyfin profile not found.", 404);
				source = {
					kind: "saved",
					profileId: input.source.profileId,
					url: stored.url,
					apiKey: secrets.decrypt(stored.id, stored.token).reveal(),
					serverId: stored.serverId,
				};
			}
			const identity = await jellyfin.connect({
				url: source.url,
				apiKey: source.apiKey,
				userId: input.userId,
			});
			if (source.kind === "saved" && identity.serverId !== source.serverId)
				throw new MediaError(
					"The saved Jellyfin URL points to a different server.",
					409,
				);
			ensureIdle();
			const id = await withConnectionWrite(async () => {
				ensureIdle();
				if (source.kind === "saved") {
					const stored = await repo.jellyfinProfile(source.profileId);
					if (
						!stored ||
						stored.url !== source.url ||
						stored.serverId !== source.serverId ||
						secrets.decrypt(stored.id, stored.token).reveal() !== source.apiKey
					)
						throw new MediaError(
							"The saved Jellyfin connection changed. Select it again and retry.",
							409,
						);
				}
				const existingProfiles = await repo.jellyfinProfiles();
				const existing = existingProfiles.find(
					(item) =>
						item.userId === identity.userId &&
						item.serverId === identity.serverId,
				);
				const profileId = existing?.id ?? randomUUID();
				const selected = {
					id: profileId,
					userId: identity.userId,
					name: identity.name,
					serverId: identity.serverId,
					url: identity.url,
					token: secrets.encrypt(profileId, identity.token),
				};
				const rows =
					input.source.kind === "new"
						? [
								...existingProfiles
									.filter(
										(item) =>
											item.serverId === identity.serverId &&
											item.id !== profileId,
									)
									.map((item) => ({
										...item,
										url: identity.url,
										token: secrets.encrypt(item.id, identity.token),
									})),
								selected,
							]
						: [selected];
				await repo.saveJellyfinProfiles(rows);
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
