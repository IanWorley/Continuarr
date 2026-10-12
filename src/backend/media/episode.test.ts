import { describe, expect, it } from "bun:test";
import {
	type EpisodeNumbering,
	type EpisodeWatchState,
	episodeWatchStateSchema,
} from "~/backend/media/episode";

const episode: EpisodeWatchState = {
	item: { service: "plex", itemId: "5012" },
	episode: {
		series: { providerIds: { tvdb: "81189", imdb: "tt0903747" } },
		providerIds: { tvdb: "349232" },
		numbering: { kind: "season", season: 1, episodes: { first: 1, count: 1 } },
	},
	watched: true,
};

function withNumbering(numbering: EpisodeNumbering): EpisodeWatchState {
	return { ...episode, episode: { ...episode.episode, numbering } };
}

function rejectedPaths(input: unknown): PropertyKey[][] | undefined {
	return episodeWatchStateSchema
		.safeParse(input)
		.error?.issues.map((issue) => issue.path);
}

describe("episodeWatchStateSchema", () => {
	it("accepts a regular-season episode with series and episode provider IDs", () => {
		expect(episodeWatchStateSchema.parse(episode)).toEqual(episode);
	});

	it.each<[string, EpisodeNumbering]>([
		["special", { kind: "special", episodes: { first: 3, count: 1 } }],
		["absolute", { kind: "absolute", episodes: { first: 147, count: 1 } }],
		[
			"multi-episode",
			{ kind: "season", season: 2, episodes: { first: 1, count: 2 } },
		],
		["unnumbered", { kind: "unnumbered" }],
	])("accepts %s numbering", (_label, numbering) => {
		const input = withNumbering(numbering);
		expect(episodeWatchStateSchema.parse(input)).toEqual(input);
	});

	it("accepts a series and episode that have no provider IDs", () => {
		const input: EpisodeWatchState = {
			...episode,
			episode: {
				...episode.episode,
				series: { providerIds: {} },
				providerIds: {},
			},
		};
		expect(episodeWatchStateSchema.parse(input)).toEqual(input);
	});

	it("rejects season 0 so specials must use special numbering", () => {
		expect(
			rejectedPaths(
				withNumbering({
					kind: "season",
					season: 0,
					episodes: { first: 1, count: 1 },
				}),
			),
		).toEqual([["episode", "numbering", "season"]]);
	});

	it("rejects an episode span that covers no episodes", () => {
		expect(
			rejectedPaths(
				withNumbering({
					kind: "absolute",
					episodes: { first: 1, count: 0 },
				}),
			),
		).toEqual([["episode", "numbering", "episodes", "count"]]);
	});

	it("rejects an empty provider ID instead of treating it as missing", () => {
		expect(
			rejectedPaths({
				...episode,
				episode: { ...episode.episode, providerIds: { tvdb: "" } },
			}),
		).toEqual([["episode", "providerIds", "tvdb"]]);
	});

	it("rejects a provider outside IMDb, TMDB, and TVDB", () => {
		expect(
			rejectedPaths({
				...episode,
				episode: { ...episode.episode, providerIds: { anidb: "4563" } },
			}),
		).toEqual([["episode", "providerIds", "anidb"]]);
	});

	it("rejects a service item reference without an item ID", () => {
		expect(
			rejectedPaths({ ...episode, item: { service: "jellyfin", itemId: "" } }),
		).toEqual([["item", "itemId"]]);
	});

	it("rejects playback position and play count outside the MVP state", () => {
		expect(
			episodeWatchStateSchema.safeParse({
				...episode,
				viewOffset: 120_000,
				playCount: 2,
			}).error?.issues,
		).toEqual([
			expect.objectContaining({
				code: "unrecognized_keys",
				keys: ["viewOffset", "playCount"],
				path: [],
			}),
		]);
	});
});
