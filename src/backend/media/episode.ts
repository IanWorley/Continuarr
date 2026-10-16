import { z } from "zod";

/** Plex and Jellyfin file specials under this season; readers map it to `special` numbering. */
export const SPECIALS_SEASON_NUMBER = 0;
export const SINGLE_EPISODE = 1;

const idSchema = z.string().min(1);
const episodeNumberSchema = z.number().int().nonnegative();

export const mediaServiceSchema = z.enum(["plex", "jellyfin"]);
export type MediaService = z.infer<typeof mediaServiceSchema>;

export const externalIdProviderSchema = z.enum(["imdb", "tmdb", "tvdb"]);
export type ExternalId = {
	provider: z.infer<typeof externalIdProviderSchema>;
	value: string;
};

/** An absent key means the service reported no ID from that provider. */
export const providerIdsSchema = z.partialRecord(
	externalIdProviderSchema,
	idSchema,
);
export type ProviderIds = z.infer<typeof providerIdsSchema>;

/**
 * A provider listed with two different values makes the whole identity
 * contradictory, so it yields no IDs rather than a guessed one.
 */
export function providerIdsFrom(ids: ExternalId[]): ProviderIds {
	const providerIds: ProviderIds = {};
	for (const { provider, value } of ids) {
		const previous = providerIds[provider];
		if (previous !== undefined && previous !== value) return {};
		providerIds[provider] = value;
	}
	return providerIds;
}

export const serviceItemRefSchema = z.strictObject({
	service: mediaServiceSchema,
	itemId: idSchema,
});
export type ServiceItemRef = z.infer<typeof serviceItemRefSchema>;

/** A file holding several episodes has a `count` above one. */
const episodeSpanSchema = z.strictObject({
	first: episodeNumberSchema,
	count: z.number().int().positive(),
});
export type EpisodeSpan = z.infer<typeof episodeSpanSchema>;

export const episodeNumberingSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("season"),
		season: z.number().int().gt(SPECIALS_SEASON_NUMBER),
		episodes: episodeSpanSchema,
	}),
	z.strictObject({ kind: z.literal("special"), episodes: episodeSpanSchema }),
	z.strictObject({ kind: z.literal("absolute"), episodes: episodeSpanSchema }),
	z.strictObject({ kind: z.literal("unnumbered") }),
]);
export type EpisodeNumbering = z.infer<typeof episodeNumberingSchema>;

export function episodeNumbering(
	season: number | undefined,
	episodes: EpisodeSpan | undefined,
): EpisodeNumbering {
	if (episodes === undefined) return { kind: "unnumbered" };
	if (season === undefined) return { kind: "absolute", episodes };
	if (season === SPECIALS_SEASON_NUMBER) return { kind: "special", episodes };
	return { kind: "season", season, episodes };
}

export const episodeIdentitySchema = z.strictObject({
	series: z.strictObject({ providerIds: providerIdsSchema }),
	providerIds: providerIdsSchema,
	numbering: episodeNumberingSchema,
});
export type EpisodeIdentity = z.infer<typeof episodeIdentitySchema>;

export const episodeWatchStateSchema = z.strictObject({
	item: serviceItemRefSchema,
	episode: episodeIdentitySchema,
	watched: z.boolean(),
});
export type EpisodeWatchState = z.infer<typeof episodeWatchStateSchema>;
