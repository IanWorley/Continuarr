import { z } from "zod";
import { endpoint, requestEmpty, requestJson } from "~/backend/media/http";
import {
	type JellyfinAccess,
	type JellyfinProvider,
	jsonObjectSchema,
	type MediaAccess,
	MediaError,
	type MediaItem,
	serverUrl,
} from "~/backend/media/model";

const PAGE_SIZE = 100;
const CLIENT_NAME = "Continuarr";
const CLIENT_VERSION = "1.0.0";

const publicInfoSchema = z.object({
	Id: z.string().min(1),
	ServerName: z.string().min(1),
});
const userSchema = z
	.object({
		Id: z.string().min(1),
		Name: z.string().min(1),
		ServerId: z.string().min(1).nullish(),
		Policy: z
			.object({
				IsDisabled: z.boolean().optional(),
				IsAdministrator: z.boolean().optional(),
			})
			.catchall(z.json())
			.nullish(),
		LastActivityDate: z.string().nullish(),
		LastLoginDate: z.string().nullish(),
	})
	.catchall(z.json());
const providerIdsSchema = z.record(z.string(), z.string());
const itemSchema = z.object({
	Id: z.string().min(1),
	Name: z.string().default(""),
	Path: z.string().nullish(),
	SeriesId: z.string().nullish(),
	SeriesName: z.string().nullish(),
	ParentIndexNumber: z.number().int().nonnegative().nullish(),
	IndexNumber: z.number().int().nonnegative().nullish(),
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
	return new Headers({
		Authorization: `MediaBrowser Client="${CLIENT_NAME}", Device="server", DeviceId="${clientIdentifier}", Version="${CLIENT_VERSION}"${token ? `, Token="${token}"` : ""}`,
	});
}

function toMediaItem(item: z.infer<typeof itemSchema>): MediaItem {
	const ids: MediaItem["ids"] = [];
	for (const [key, value] of Object.entries(item.ProviderIds ?? {})) {
		const provider = key.toLowerCase();
		if (provider === "imdb" || provider === "tmdb" || provider === "tvdb") {
			if (value) ids.push({ provider, value });
		}
	}
	const details: NonNullable<MediaItem["details"]> = {
		paths: item.Path ? [item.Path] : undefined,
		...(item.Type === "Episode"
			? {
					showId: item.SeriesId ?? undefined,
					showTitle: item.SeriesName ?? undefined,
					season: item.ParentIndexNumber ?? undefined,
					episode: item.IndexNumber ?? undefined,
				}
			: {}),
	};
	return {
		id: item.Id,
		kind: item.Type === "Movie" ? "movie" : "episode",
		title: item.Name,
		ids,
		watched: item.UserData.Played,
		...(Object.values(details).some((value) => value !== undefined)
			? { details }
			: {}),
	};
}

export function createJellyfinProvider(options: {
	clientIdentifier: string;
	fetch?: typeof globalThis.fetch;
}): JellyfinProvider {
	const fetcher = options.fetch ?? globalThis.fetch;
	async function server({ url, token }: MediaAccess) {
		const info = await requestJson({
			fetch: fetcher,
			url: endpoint(serverUrl(url), "System/Info"),
			schema: publicInfoSchema,
			headers: jellyfinHeaders(options.clientIdentifier, token.reveal()),
		});
		return { id: info.Id, name: info.ServerName };
	}

	return {
		async directory(access) {
			const serverIdentity = await server(access);
			const users = await requestJson({
				fetch: fetcher,
				url: endpoint(serverUrl(access.url), "Users"),
				schema: z.array(jsonObjectSchema),
				headers: jellyfinHeaders(
					options.clientIdentifier,
					access.token.reveal(),
				),
			});
			const seen = new Set<string>();
			const parsedUsers = users.map((raw) => {
				const parsed = userSchema.safeParse(raw);
				if (!parsed.success)
					throw new MediaError("Jellyfin returned an unexpected user.", 502);
				return { raw, data: parsed.data };
			});
			for (const { data: user } of parsedUsers) {
				if (user.ServerId && user.ServerId !== serverIdentity.id)
					throw new MediaError(
						"Jellyfin returned a user from a different server.",
						502,
					);
				if (seen.has(user.Id))
					throw new MediaError("Jellyfin returned a duplicate user.", 502);
				seen.add(user.Id);
			}
			return {
				server: serverIdentity,
				users: parsedUsers.map(({ raw, data: user }) => ({
					id: user.Id,
					name: user.Name,
					disabled: user.Policy?.IsDisabled ?? false,
					administrator: user.Policy?.IsAdministrator ?? false,
					lastActivityDate: user.LastActivityDate ?? null,
					lastLoginDate: user.LastLoginDate ?? null,
					details: raw,
				})),
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
				url.searchParams.set("Fields", "ProviderIds,Path");
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
