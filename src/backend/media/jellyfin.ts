import { z } from "zod";
import { endpoint, requestEmpty, requestJson } from "~/backend/media/http";
import {
	type JellyfinAccess,
	type JellyfinProvider,
	MediaError,
	type MediaItem,
	serverUrl,
} from "~/backend/media/model";
import { Secret } from "~/backend/secrets/storage";

const PAGE_SIZE = 100;
const CLIENT_NAME = "Continuarr";
const CLIENT_VERSION = "1.0.0";

const publicInfoSchema = z.object({
	Id: z.string().min(1),
	ServerName: z.string().min(1),
});
const userSchema = z.object({ Id: z.string().min(1), Name: z.string().min(1) });
const loginSchema = z.object({
	AccessToken: z.string().min(1),
	User: userSchema,
	ServerId: z.string().min(1),
});
const providerIdsSchema = z.record(z.string(), z.string());
const itemSchema = z.object({
	Id: z.string().min(1),
	Name: z.string().default(""),
	Type: z.enum(["Movie", "Episode"]),
	ProviderIds: providerIdsSchema.optional(),
	UserData: z.object({ Played: z.boolean() }),
});
const pageSchema = z.object({
	Items: z.array(itemSchema),
	TotalRecordCount: z.number().int().nonnegative(),
});
const targetSchema = z.object({
	Id: z.string().min(1),
	UserData: z.object({ Played: z.boolean() }),
});

function jellyfinHeaders(clientIdentifier: string, token?: string): Headers {
	const headers = new Headers({
		Authorization: `MediaBrowser Client="${CLIENT_NAME}", Device="server", DeviceId="${clientIdentifier}", Version="${CLIENT_VERSION}"`,
	});
	if (token) headers.set("X-Emby-Token", token);
	return headers;
}

function toMediaItem(item: z.infer<typeof itemSchema>): MediaItem {
	const ids: MediaItem["ids"] = [];
	for (const [key, value] of Object.entries(item.ProviderIds ?? {})) {
		const provider = key.toLowerCase();
		if (provider === "imdb" || provider === "tmdb" || provider === "tvdb") {
			if (value) ids.push({ provider, value });
		}
	}
	return {
		id: item.Id,
		kind: item.Type === "Movie" ? "movie" : "episode",
		title: item.Name,
		ids,
		watched: item.UserData.Played,
	};
}

export function createJellyfinProvider(options: {
	clientIdentifier: string;
	fetch?: typeof globalThis.fetch;
}): JellyfinProvider {
	const fetcher = options.fetch ?? globalThis.fetch;

	return {
		async login({ url, username, password }) {
			const normalizedUrl = serverUrl(url);
			const info = await requestJson({
				fetch: fetcher,
				url: endpoint(normalizedUrl, "System/Info/Public"),
				schema: publicInfoSchema,
				headers: jellyfinHeaders(options.clientIdentifier),
			});
			const login = await requestJson({
				fetch: fetcher,
				url: endpoint(normalizedUrl, "Users/AuthenticateByName"),
				schema: loginSchema,
				method: "POST",
				headers: jellyfinHeaders(options.clientIdentifier),
				body: { Username: username, Pw: password },
			});
			if (login.ServerId !== info.Id)
				throw new MediaError(
					"Jellyfin returned a different server identity.",
					502,
				);
			const profile = await requestJson({
				fetch: fetcher,
				url: endpoint(normalizedUrl, "Users/Me"),
				schema: userSchema,
				headers: jellyfinHeaders(options.clientIdentifier, login.AccessToken),
			});
			if (profile.Id !== login.User.Id)
				throw new MediaError(
					"Jellyfin returned a different user identity.",
					502,
				);
			return {
				url: normalizedUrl,
				token: new Secret(login.AccessToken),
				userId: profile.Id,
				serverId: info.Id,
				name: profile.Name,
			};
		},

		async items(access) {
			const headers = jellyfinHeaders(
				options.clientIdentifier,
				access.token.reveal(),
			);
			const items: MediaItem[] = [];
			const seen = new Set<string>();
			let offset = 0;
			let total: number | undefined;
			do {
				const url = endpoint(
					access.url,
					`Users/${encodeURIComponent(access.userId)}/Items`,
				);
				url.searchParams.set("Recursive", "true");
				url.searchParams.set("IncludeItemTypes", "Movie,Episode");
				url.searchParams.set("Fields", "ProviderIds");
				url.searchParams.set("StartIndex", String(offset));
				url.searchParams.set("Limit", String(PAGE_SIZE));
				const page = await requestJson({
					fetch: fetcher,
					url,
					schema: pageSchema,
					headers,
				});
				if (total === undefined) total = page.TotalRecordCount;
				if (
					page.TotalRecordCount !== total ||
					page.Items.length > PAGE_SIZE ||
					(page.Items.length === 0 && offset < total)
				) {
					throw new MediaError(
						"Jellyfin returned an incomplete library page.",
						502,
					);
				}
				for (const item of page.Items) {
					if (seen.has(item.Id))
						throw new MediaError("Jellyfin returned a duplicate item.", 502);
					seen.add(item.Id);
					items.push(toMediaItem(item));
				}
				offset += page.Items.length;
				if (offset > total || (offset < total && page.Items.length < PAGE_SIZE))
					throw new MediaError(
						"Jellyfin returned an incomplete library page.",
						502,
					);
			} while (offset < total);
			return items;
		},

		async markWatched(access: JellyfinAccess, itemId: string) {
			const headers = jellyfinHeaders(
				options.clientIdentifier,
				access.token.reveal(),
			);
			const path = `Users/${encodeURIComponent(access.userId)}/Items/${encodeURIComponent(itemId)}`;
			const target = await requestJson({
				fetch: fetcher,
				url: endpoint(access.url, path),
				schema: targetSchema,
				headers,
			});
			if (target.Id !== itemId)
				throw new MediaError("Jellyfin returned a different item.", 502);
			if (target.UserData.Played) return;
			await requestEmpty({
				fetch: fetcher,
				url: endpoint(
					access.url,
					`Users/${encodeURIComponent(access.userId)}/PlayedItems/${encodeURIComponent(itemId)}`,
				),
				method: "POST",
				headers,
			});
		},
	};
}
