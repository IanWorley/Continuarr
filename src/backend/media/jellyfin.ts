import { z } from "zod";
import {
	type EpisodeSpan,
	episodeNumbering,
	type ProviderIds,
	providerIdsFrom,
	SINGLE_EPISODE,
} from "~/backend/media/episode";
import { endpoint, requestEmpty, requestJson } from "~/backend/media/http";
import {
	type EpisodeItem,
	isStale,
	type JellyfinAccess,
	type JellyfinProvider,
	jsonObjectSchema,
	type MediaAccess,
	MediaError,
	type MediaItem,
	restoreAfterMark,
	samePosition,
	serverUrl,
	type WatchedWriteOptions,
} from "~/backend/media/model";
import { Secret } from "~/backend/secrets/storage";

const PAGE_SIZE = 100;
const CLIENT_NAME = "Continuarr";
const CLIENT_VERSION = "1.0.0";
export const TICKS_PER_MILLISECOND = 10_000;

const publicInfoSchema = z.object({
	Id: z.string().min(1),
	ServerName: z.string().min(1),
});
const authenticationSchema = z.object({
	AccessToken: z.string().min(1),
	User: z.object({
		Id: z.string().min(1),
		Name: z.string().min(1),
		Policy: z.object({ IsAdministrator: z.boolean() }),
	}),
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
	IndexNumberEnd: z.number().int().nonnegative().nullish(),
	Type: z.enum(["Movie", "Episode"]),
	ProviderIds: providerIdsSchema.optional(),
	UserData: z.object({
		Played: z.boolean(),
		LastPlayedDate: z.iso.datetime({ offset: true }).nullish(),
		PlaybackPositionTicks: z.number().int().nonnegative().nullish(),
	}),
});
const pageSchema = z.object({
	Items: z.array(itemSchema),
	TotalRecordCount: z.number().int().nonnegative(),
});
const seriesPageSchema = z.object({
	Items: z.array(
		z.object({
			Id: z.string().min(1),
			ProviderIds: providerIdsSchema.optional(),
		}),
	),
});
const userDataSchema = z
	.object({
		Played: z.boolean(),
		LastPlayedDate: z.iso.datetime({ offset: true }).nullish(),
		PlaybackPositionTicks: z.number().int().nonnegative().nullish(),
	})
	.catchall(z.json());
const targetSchema = z.object({
	Id: z.string().min(1),
	UserData: userDataSchema,
});

function toPositionMs(ticks: number | null | undefined): number {
	return Math.floor((ticks ?? 0) / TICKS_PER_MILLISECOND);
}

function jellyfinHeaders(clientIdentifier: string, token?: string): Headers {
	return new Headers({
		Authorization: `MediaBrowser Client="${CLIENT_NAME}", Device="server", DeviceId="${clientIdentifier}", Version="${CLIENT_VERSION}"${token ? `, Token="${token}"` : ""}`,
	});
}

type Item = z.infer<typeof itemSchema>;

function externalIds(
	providerIds: z.infer<typeof providerIdsSchema> = {},
): MediaItem["ids"] {
	const ids: MediaItem["ids"] = [];
	for (const [key, value] of Object.entries(providerIds)) {
		const provider = key.toLowerCase();
		if (provider === "imdb" || provider === "tmdb" || provider === "tvdb") {
			if (value) ids.push({ provider, value });
		}
	}
	return ids;
}

/** Jellyfin reports a multi-episode file as one item ending at `IndexNumberEnd`. */
function episodeSpan(item: Item): EpisodeSpan | undefined {
	const first = item.IndexNumber;
	if (first == null) return undefined;
	const last = Math.max(item.IndexNumberEnd ?? first, first);
	return { first, count: last - first + SINGLE_EPISODE };
}

function toMediaItem(
	item: Item,
	episode: EpisodeItem["episode"] | null,
): MediaItem {
	const details: NonNullable<MediaItem["details"]> = {
		paths: item.Path ? [item.Path] : undefined,
		...(episode
			? {
					showTitle: item.SeriesName ?? undefined,
					season: item.ParentIndexNumber ?? undefined,
					episode: item.IndexNumber ?? undefined,
				}
			: {}),
	};
	const { LastPlayedDate, PlaybackPositionTicks } = item.UserData;
	const positionMs = toPositionMs(PlaybackPositionTicks);
	const mediaItem = {
		id: item.Id,
		title: item.Name,
		ids: externalIds(item.ProviderIds),
		watched: item.UserData.Played,
		history: {
			lastPlayedAt: LastPlayedDate ? Date.parse(LastPlayedDate) : null,
			positionMs: positionMs > 0 ? positionMs : null,
		},
		...(Object.values(details).some((value) => value !== undefined)
			? { details }
			: {}),
	};
	return episode
		? { ...mediaItem, kind: "episode", episode }
		: { ...mediaItem, kind: "movie" };
}

export function createJellyfinProvider(options: {
	clientIdentifier: string;
	fetch?: typeof globalThis.fetch;
}): JellyfinProvider {
	const fetcher = options.fetch ?? globalThis.fetch;
	async function readItem(access: JellyfinAccess, itemId: string) {
		const headers = jellyfinHeaders(
			options.clientIdentifier,
			access.token.reveal(),
		);
		const target = await requestJson({
			fetch: fetcher,
			url: endpoint(
				access.url,
				`Users/${encodeURIComponent(access.userId)}/Items/${encodeURIComponent(itemId)}`,
			),
			schema: targetSchema,
			headers,
		});
		if (target.Id !== itemId)
			throw new MediaError("Jellyfin returned a different item.", 502);
		return { userData: target.UserData, headers };
	}

	function assertPosition(positionMs: number) {
		if (!Number.isSafeInteger(positionMs) || positionMs <= 0)
			throw new MediaError("Invalid Jellyfin resume position.");
	}

	async function writePosition(
		access: JellyfinAccess,
		itemId: string,
		userData: Awaited<ReturnType<typeof readItem>>["userData"],
		positionMs: number,
		headers: Headers,
	) {
		await requestEmpty({
			fetch: fetcher,
			url: endpoint(
				access.url,
				`Users/${encodeURIComponent(access.userId)}/Items/${encodeURIComponent(itemId)}/UserData`,
			),
			method: "POST",
			headers,
			body: {
				...userData,
				PlaybackPositionTicks: positionMs * TICKS_PER_MILLISECOND,
			},
		});
	}

	async function server({ url, token }: MediaAccess) {
		const info = await requestJson({
			fetch: fetcher,
			url: endpoint(serverUrl(url), "System/Info"),
			schema: publicInfoSchema,
			headers: jellyfinHeaders(options.clientIdentifier, token.reveal()),
		});
		return { id: info.Id, name: info.ServerName };
	}

	async function readSeriesIds(
		access: JellyfinAccess,
		headers: Headers,
		seriesId: string,
	): Promise<ProviderIds> {
		const url = endpoint(
			access.url,
			`Users/${encodeURIComponent(access.userId)}/Items`,
		);
		url.searchParams.set("Ids", seriesId);
		url.searchParams.set("Fields", "ProviderIds");
		const { Items } = await requestJson({
			fetch: fetcher,
			url,
			schema: seriesPageSchema,
			headers,
		});
		const [series] = Items;
		if (Items.length !== 1 || series?.Id !== seriesId)
			throw new MediaError("Jellyfin returned a different series.", 502);
		return providerIdsFrom(externalIds(series.ProviderIds));
	}

	return {
		async authenticate({ url, username, password }) {
			const normalizedUrl = serverUrl(url);
			const session = await requestJson({
				fetch: fetcher,
				url: endpoint(normalizedUrl, "Users/AuthenticateByName"),
				method: "POST",
				schema: authenticationSchema,
				headers: jellyfinHeaders(options.clientIdentifier),
				body: { Username: username, Pw: password.reveal() },
			});
			if (!session.User.Policy.IsAdministrator)
				throw new MediaError("Sign in with a Jellyfin administrator account.");
			const access = {
				url: normalizedUrl,
				token: new Secret(session.AccessToken),
			};
			return {
				server: await server(access),
				user: { id: session.User.Id, name: session.User.Name },
				access,
			};
		},

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
			const entries: Item[] = [];
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
					entries.push(item);
				}
				offset += page.Items.length;
				if (offset > total || (offset < total && page.Items.length < PAGE_SIZE))
					throw new MediaError(
						"Jellyfin returned an incomplete library page.",
						502,
					);
			} while (offset < total);
			const seriesIds = new Map<string, ProviderIds>();
			for (const { Type, SeriesId } of entries) {
				if (Type === "Episode" && SeriesId && !seriesIds.has(SeriesId))
					seriesIds.set(
						SeriesId,
						await readSeriesIds(access, headers, SeriesId),
					);
			}
			return entries.map((item) => {
				if (item.Type === "Movie") return toMediaItem(item, null);
				const providerIds = item.SeriesId
					? seriesIds.get(item.SeriesId)
					: undefined;
				return toMediaItem(item, {
					series: {
						localId: item.SeriesId ?? null,
						providerIds: providerIds ?? {},
					},
					numbering: episodeNumbering(
						item.ParentIndexNumber ?? undefined,
						episodeSpan(item),
					),
				});
			});
		},

		async markWatched(
			access: JellyfinAccess,
			itemId: string,
			{ replaces, playedAt, resumeAt }: WatchedWriteOptions,
		) {
			const datePlayed =
				playedAt === undefined ? undefined : new Date(playedAt);
			if (datePlayed && Number.isNaN(datePlayed.getTime()))
				throw new MediaError("Invalid Jellyfin played date.");
			if (resumeAt !== undefined) assertPosition(resumeAt);
			const { userData, headers } = await readItem(access, itemId);
			const current = toPositionMs(userData.PlaybackPositionTicks);
			if (isStale(current, replaces, resumeAt)) return "stale";
			if (!userData.Played) {
				const url = endpoint(
					access.url,
					`Users/${encodeURIComponent(access.userId)}/PlayedItems/${encodeURIComponent(itemId)}`,
				);
				const lastPlayed = userData.LastPlayedDate
					? Date.parse(userData.LastPlayedDate)
					: null;
				if (
					datePlayed &&
					(lastPlayed === null || datePlayed.getTime() >= lastPlayed)
				)
					url.searchParams.set("datePlayed", datePlayed.toISOString());
				await requestEmpty({ fetch: fetcher, url, method: "POST", headers });
			}
			if (resumeAt === undefined) return "applied";
			const marked = userData.Played
				? userData
				: (await readItem(access, itemId)).userData;
			const restore = restoreAfterMark(
				toPositionMs(marked.PlaybackPositionTicks),
				replaces,
				resumeAt,
			);
			if (restore === "stale") return "stale";
			if (restore === "write")
				await writePosition(access, itemId, marked, resumeAt, headers);
			return "applied";
		},

		async setPosition(
			access: JellyfinAccess,
			itemId: string,
			positionMs: number,
			replaces: number | null,
		) {
			assertPosition(positionMs);
			const { userData, headers } = await readItem(access, itemId);
			const current = toPositionMs(userData.PlaybackPositionTicks);
			if (samePosition(current, positionMs)) return "applied";
			if (isStale(current, replaces, positionMs)) return "stale";
			await writePosition(access, itemId, userData, positionMs, headers);
			return "applied";
		},
	};
}
