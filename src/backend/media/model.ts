import { z } from "zod";
import {
	episodeIdentitySchema,
	externalIdProviderSchema,
} from "~/backend/media/episode";
import type { Secret } from "~/backend/secrets/storage";
import { NO_POSITION_MS, POSITION_TOLERANCE_MS } from "./constants";

const mediaItemBaseSchema = z.object({
	id: z.string().min(1),
	title: z.string(),
	ids: z.array(
		z.object({
			provider: externalIdProviderSchema,
			value: z.string().min(1),
		}),
	),
	watched: z.boolean(),
	history: z.object({
		lastPlayedAt: z.number().int().nullable(),
		positionMs: z.number().int().positive().nullable(),
	}),
	/** Raw values as each server reports them, for display only. */
	details: z
		.object({
			paths: z.array(z.string()).optional(),
			showTitle: z.string().optional(),
			season: z.number().int().nonnegative().optional(),
			episode: z.number().int().nonnegative().optional(),
		})
		.optional(),
});
export const mediaItemSchema = z.discriminatedUnion("kind", [
	mediaItemBaseSchema.extend({ kind: z.literal("movie") }),
	mediaItemBaseSchema.extend({
		kind: z.literal("episode"),
		// The episode's own provider IDs stay in `ids` with every other item's.
		episode: episodeIdentitySchema.omit({ providerIds: true }).extend({
			series: episodeIdentitySchema.shape.series.extend({
				localId: z.string().min(1).nullable(),
			}),
		}),
	}),
]);
export type MediaItem = z.infer<typeof mediaItemSchema>;
export type EpisodeItem = Extract<MediaItem, { kind: "episode" }>;
export type MediaAccess = { url: string; token: Secret };
export type JellyfinAccess = MediaAccess & { userId: string };
export const jsonObjectSchema = z.record(z.string(), z.json());
export type JsonObject = z.infer<typeof jsonObjectSchema>;
export type PlexHomeUser = { id: string; name: string; protected: boolean };
export type PlexDirectoryUser = {
	id: string;
	name: string;
	access:
		| { kind: "owner" }
		| { kind: "shared_grant"; token: Secret }
		| { kind: "unavailable" };
};
export type PlexServer = {
	id: string;
	name: string;
	token: Secret;
	connections: string[];
};
export type JellyfinUser = {
	id: string;
	name: string;
	disabled: boolean;
	administrator: boolean;
	lastActivityDate: string | null;
	lastLoginDate: string | null;
	details: JsonObject;
};
export type JellyfinServer = { id: string; name: string };
export type JellyfinDirectory = {
	server: JellyfinServer;
	users: JellyfinUser[];
};
export type JellyfinAdminConnection = {
	server: JellyfinServer;
	user: { id: string; name: string };
	access: MediaAccess;
};
export type PlexIdentity = { userId: string; name: string; token: Secret };
export type PlexPin = {
	id: number;
	code: string;
	expiresIn: number;
	authorizationUrl: string;
};
/** `stale` means the item's position moved since the scan, so nothing was written. */
export type WriteResult = "applied" | "stale";
/**
 * A write is stale when the item's position moved away from what the planner
 * saw, unless it already holds the target. Overwriting it would lose newer playback.
 */
export function isStale(
	currentMs: number,
	replaces: number | null,
	targetMs: number | undefined,
): boolean {
	if (
		targetMs !== undefined &&
		Math.abs(currentMs - targetMs) <= POSITION_TOLERANCE_MS
	)
		return false;
	return (
		Math.abs(currentMs - (replaces ?? NO_POSITION_MS)) > POSITION_TOLERANCE_MS
	);
}
/** `replaces` is the position the planner saw; marking clears it, so `resumeAt` is written back. */
export type WatchedWriteOptions = {
	replaces: number | null;
	playedAt?: number;
	resumeAt?: number;
};
export interface PlexProvider {
	startLogin(): Promise<PlexPin>;
	pollLogin(pin: Pick<PlexPin, "id" | "code">): Promise<PlexIdentity | null>;
	homeUsers(token: Secret): Promise<PlexHomeUser[]>;
	directory(input: {
		token: Secret;
		owner: Pick<PlexIdentity, "userId" | "name">;
		serverId: string;
	}): Promise<PlexDirectoryUser[]>;
	servers(token: Secret): Promise<PlexServer[]>;
	verifyServer(access: MediaAccess, serverId: string): Promise<void>;
	items(access: MediaAccess): Promise<MediaItem[]>;
	// Plex has no API for a dated scrobble, so the Plex provider ignores playedAt.
	markWatched(
		access: MediaAccess,
		itemId: string,
		options: WatchedWriteOptions,
	): Promise<WriteResult>;
	setPosition(
		access: MediaAccess,
		itemId: string,
		positionMs: number,
		replaces: number | null,
	): Promise<WriteResult>;
}
export interface JellyfinProvider {
	authenticate(credentials: {
		url: string;
		username: string;
		password: Secret;
	}): Promise<JellyfinAdminConnection>;
	directory(access: MediaAccess): Promise<JellyfinDirectory>;
	items(access: JellyfinAccess): Promise<MediaItem[]>;
	markWatched(
		access: JellyfinAccess,
		itemId: string,
		options: WatchedWriteOptions,
	): Promise<WriteResult>;
	setPosition(
		access: JellyfinAccess,
		itemId: string,
		positionMs: number,
		replaces: number | null,
	): Promise<WriteResult>;
}
export class MediaError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 404 | 409 | 502 = 400,
	) {
		super(message);
	}
}
export function serverUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new MediaError("Enter a valid server URL.");
	}
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new MediaError(
			"Use an HTTP or HTTPS server URL without credentials, query parameters, or fragments.",
		);
	}
	return url.toString().replace(/\/+$/, "");
}

export const manualMatchSchema = z.object({
	pairingId: z.string().min(1),
	plexItemId: z.string().min(1),
	jellyfinItemId: z.string().min(1),
});
export type ManualMatch = z.infer<typeof manualMatchSchema>;

export const showMatchSchema = z.object({
	pairingId: z.string().min(1),
	plexShowId: z.string().min(1),
	jellyfinShowId: z.string().min(1),
});
export type ShowMatch = z.infer<typeof showMatchSchema>;

export type LibraryShow = { id: string; title: string; episodeCount: number };

/** Shows are known only through their episodes, so a show with none is absent. */
export function showsInLibrary(items: readonly MediaItem[]): LibraryShow[] {
	const shows = new Map<string, LibraryShow>();
	for (const item of items) {
		if (item.kind !== "episode" || item.episode.series.localId === null)
			continue;
		const id = item.episode.series.localId;
		const existing = shows.get(id);
		if (existing) existing.episodeCount++;
		else
			shows.set(id, {
				id,
				title: item.details?.showTitle ?? id,
				episodeCount: 1,
			});
	}
	return [...shows.values()].sort(
		(left, right) =>
			left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
	);
}
