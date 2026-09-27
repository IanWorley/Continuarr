import { z } from "zod";
import type { Secret } from "~/backend/secrets/storage";

export const mediaItemSchema = z.object({
	id: z.string().min(1),
	kind: z.enum(["movie", "episode"]),
	title: z.string(),
	ids: z.array(
		z.object({
			provider: z.enum(["imdb", "tmdb", "tvdb"]),
			value: z.string().min(1),
		}),
	),
	watched: z.boolean(),
});
export type MediaItem = z.infer<typeof mediaItemSchema>;
export type MediaAccess = { url: string; token: Secret };
export type JellyfinAccess = MediaAccess & { userId: string };
export type PlexHomeUser = { id: string; name: string; protected: boolean };
export type PlexUserOption =
	| { kind: "owner"; id: string; name: string }
	| ({ kind: "home" } & PlexHomeUser)
	| { kind: "shared"; id: string; name: string };
export type PlexServer = {
	id: string;
	name: string;
	token: Secret;
	connections: string[];
};
export type PlexSharedUser = {
	id: string;
	name: string;
	servers: PlexServer[];
};
export type JellyfinSource =
	| { kind: "new"; url: string; apiKey: string }
	| { kind: "saved"; profileId: string };
export type PlexIdentity = { userId: string; name: string; token: Secret };
export type PlexPin = {
	id: number;
	code: string;
	expiresIn: number;
	authorizationUrl: string;
};
export interface PlexProvider {
	startLogin(): Promise<PlexPin>;
	pollLogin(pin: Pick<PlexPin, "id" | "code">): Promise<PlexIdentity | null>;
	homeUsers(token: Secret): Promise<PlexHomeUser[]>;
	sharedUsers(token: Secret): Promise<PlexSharedUser[]>;
	switchUser(input: {
		token: Secret;
		userId: string;
		pin?: string;
	}): Promise<PlexIdentity>;
	servers(token: Secret): Promise<PlexServer[]>;
	verifyServer(access: MediaAccess, serverId: string): Promise<void>;
	items(access: MediaAccess): Promise<MediaItem[]>;
	markWatched(access: MediaAccess, itemId: string): Promise<void>;
}
export interface JellyfinProvider {
	server(input: {
		url: string;
		apiKey: string;
	}): Promise<{ id: string; name: string }>;
	users(input: {
		url: string;
		apiKey: string;
	}): Promise<{ id: string; name: string }[]>;
	connect(input: {
		url: string;
		apiKey: string;
		userId: string;
	}): Promise<JellyfinAccess & { serverId: string; name: string }>;
	items(access: JellyfinAccess): Promise<MediaItem[]>;
	markWatched(access: JellyfinAccess, itemId: string): Promise<void>;
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
