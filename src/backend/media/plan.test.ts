import { describe, expect, it } from "bun:test";
import type { EpisodeNumbering, ProviderIds } from "~/backend/media/episode";
import {
	type EpisodeItem,
	type MediaItem,
	showsInLibrary,
} from "~/backend/media/model";
import { planWatchedUnion } from "~/backend/media/plan";

const NO_HISTORY: MediaItem["history"] = {
	lastPlayedAt: null,
	positionMs: null,
};
const NO_SKIP_REASONS = {
	missingSeriesIds: 0,
	missingEpisodeIds: 0,
	unsupportedNumbering: 0,
	staleShowMatches: 0,
};
const UNKNOWN_SHOW: EpisodeItem["episode"] = {
	series: { localId: null, providerIds: {} },
	numbering: { kind: "unnumbered" },
};
const BREAKING_BAD: ProviderIds = { tvdb: "81189", imdb: "tt0903747" };

function regular(season: number, first: number, count = 1): EpisodeNumbering {
	return { kind: "season", season, episodes: { first, count } };
}

function movie(
	id: string,
	watched: boolean,
	ids: MediaItem["ids"],
	title = id,
	history: MediaItem["history"] = NO_HISTORY,
): MediaItem {
	return { id, kind: "movie", title, ids, watched, history };
}

function episode(
	id: string,
	watched: boolean,
	ids: MediaItem["ids"],
	identity: EpisodeItem["episode"] = UNKNOWN_SHOW,
): MediaItem {
	return {
		id,
		kind: "episode",
		title: id,
		ids,
		watched,
		history: NO_HISTORY,
		episode: identity,
	};
}

function inShow(
	id: string,
	numbering: EpisodeNumbering,
	options: {
		series?: ProviderIds;
		localId?: string;
		ids?: MediaItem["ids"];
		watched?: boolean;
	} = {},
): MediaItem {
	return episode(id, options.watched ?? false, options.ids ?? [], {
		series: {
			localId: options.localId ?? null,
			providerIds: options.series ?? BREAKING_BAD,
		},
		numbering,
	});
}

describe("planWatchedUnion", () => {
	it("marks only the unwatched Jellyfin item when Plex is watched", () => {
		expect(
			planWatchedUnion({
				plex: [movie("p1", true, [{ provider: "imdb", value: "tt0001" }])],
				jellyfin: [
					movie("j1", false, [{ provider: "imdb", value: "tt0001" }], "Film"),
				],
			}),
		).toEqual({
			writes: [
				{ kind: "watched", target: "jellyfin", itemId: "j1", title: "Film" },
			],
			matched: 1,
			unmatched: 0,
			ambiguous: 0,
			positionConflicts: 0,
			...NO_SKIP_REASONS,
			pairs: [{ plexItemId: "p1", jellyfinItemId: "j1", source: "exactIds" }],
		});
	});

	it("marks only the unwatched Plex item when Jellyfin is watched", () => {
		expect(
			planWatchedUnion({
				plex: [episode("p1", false, [{ provider: "tvdb", value: "10" }])],
				jellyfin: [episode("j1", true, [{ provider: "tvdb", value: "10" }])],
			}).writes,
		).toEqual([{ kind: "watched", target: "plex", itemId: "p1", title: "p1" }]);
	});

	it("plans no write when watched states already agree", () => {
		for (const watched of [true, false]) {
			expect(
				planWatchedUnion({
					plex: [movie("p1", watched, [{ provider: "tmdb", value: "8" }])],
					jellyfin: [movie("j1", watched, [{ provider: "tmdb", value: "8" }])],
				}),
			).toEqual({
				writes: [],
				matched: 1,
				unmatched: 0,
				ambiguous: 0,
				positionConflicts: 0,
				...NO_SKIP_REASONS,
				pairs: [{ plexItemId: "p1", jellyfinItemId: "j1", source: "exactIds" }],
			});
		}
	});

	it("does not match a movie to an episode with the same external ID", () => {
		expect(
			planWatchedUnion({
				plex: [movie("p1", true, [{ provider: "imdb", value: "tt1" }])],
				jellyfin: [episode("j1", false, [{ provider: "imdb", value: "tt1" }])],
			}),
		).toEqual({
			writes: [],
			matched: 0,
			unmatched: 2,
			ambiguous: 0,
			positionConflicts: 0,
			...NO_SKIP_REASONS,
			pairs: [],
			missingSeriesIds: 1,
		});
	});

	it("rejects duplicate candidates on either provider", () => {
		expect(
			planWatchedUnion({
				plex: [movie("p1", true, [{ provider: "imdb", value: "tt1" }])],
				jellyfin: [
					movie("j1", false, [{ provider: "imdb", value: "tt1" }]),
					movie("j2", false, [{ provider: "imdb", value: "tt1" }]),
				],
			}),
		).toEqual({
			writes: [],
			matched: 0,
			unmatched: 0,
			ambiguous: 3,
			positionConflicts: 0,
			...NO_SKIP_REASONS,
			pairs: [],
		});
	});

	it("rejects a shared ID when another shared namespace conflicts", () => {
		expect(
			planWatchedUnion({
				plex: [
					movie("p1", true, [
						{ provider: "imdb", value: "tt1" },
						{ provider: "tmdb", value: "8" },
					]),
				],
				jellyfin: [
					movie("j1", false, [
						{ provider: "imdb", value: "tt1" },
						{ provider: "tmdb", value: "9" },
					]),
				],
			}),
		).toEqual({
			writes: [],
			matched: 0,
			unmatched: 0,
			ambiguous: 2,
			positionConflicts: 0,
			...NO_SKIP_REASONS,
			pairs: [],
		});
	});

	it("does not use titles when external IDs are missing", () => {
		expect(
			planWatchedUnion({
				plex: [movie("p1", true, [], "Same title")],
				jellyfin: [movie("j1", false, [], "Same title")],
			}),
		).toEqual({
			writes: [],
			matched: 0,
			unmatched: 2,
			ambiguous: 0,
			positionConflicts: 0,
			...NO_SKIP_REASONS,
			pairs: [],
		});
	});
});

describe("series and episode number matching", () => {
	it("pairs episodes without episode IDs by shared series ID and equal numbers", () => {
		expect(
			planWatchedUnion({
				plex: [
					inShow("p1", regular(1, 1), { watched: true }),
					inShow("p2", regular(1, 2)),
				],
				jellyfin: [
					inShow("j1", regular(1, 1), { series: { tvdb: "81189" } }),
					inShow("j2", regular(1, 2), { series: { tvdb: "81189" } }),
				],
			}),
		).toEqual({
			writes: [
				{ kind: "watched", target: "jellyfin", itemId: "j1", title: "j1" },
			],
			matched: 2,
			unmatched: 0,
			ambiguous: 0,
			positionConflicts: 0,
			...NO_SKIP_REASONS,
			pairs: [
				{ plexItemId: "p1", jellyfinItemId: "j1", source: "seriesNumber" },
				{ plexItemId: "p2", jellyfinItemId: "j2", source: "seriesNumber" },
			],
		});
	});

	it("leaves episodes with different numbers unmatched", () => {
		expect(
			planWatchedUnion({
				plex: [inShow("p1", regular(1, 1), { watched: true })],
				jellyfin: [inShow("j1", regular(1, 2))],
			}),
		).toEqual({
			writes: [],
			matched: 0,
			unmatched: 2,
			ambiguous: 0,
			positionConflicts: 0,
			...NO_SKIP_REASONS,
			pairs: [],
			missingEpisodeIds: 2,
		});
	});

	it.each<[string, EpisodeNumbering]>([
		["specials", { kind: "special", episodes: { first: 1, count: 1 } }],
		[
			"absolute numbers",
			{ kind: "absolute", episodes: { first: 1, count: 1 } },
		],
		["multi-episode files", regular(1, 1, 2)],
		["unnumbered episodes", { kind: "unnumbered" }],
	])("reports %s in a shared series as ambiguous", (_label, numbering) => {
		expect(
			planWatchedUnion({
				plex: [inShow("p1", numbering, { watched: true })],
				jellyfin: [inShow("j1", numbering)],
			}),
		).toEqual({
			writes: [],
			matched: 0,
			unmatched: 0,
			ambiguous: 2,
			positionConflicts: 0,
			...NO_SKIP_REASONS,
			pairs: [],
			unsupportedNumbering: 2,
		});
	});

	it("reports a special as unmatched when the other server lacks its series", () => {
		const special: EpisodeNumbering = {
			kind: "special",
			episodes: { first: 1, count: 1 },
		};
		expect(
			planWatchedUnion({
				plex: [inShow("p1", special)],
				jellyfin: [inShow("j1", special, { series: { tvdb: "1" } })],
			}),
		).toMatchObject({
			matched: 0,
			unmatched: 2,
			ambiguous: 0,
			unsupportedNumbering: 0,
		});
	});

	it("refuses series that share one provider ID and conflict on another", () => {
		expect(
			planWatchedUnion({
				plex: [inShow("p1", regular(1, 1), { watched: true })],
				jellyfin: [
					inShow("j1", regular(1, 1), {
						series: { tvdb: "81189", imdb: "tt9999999" },
					}),
				],
			}),
		).toMatchObject({ writes: [], matched: 0, unmatched: 0, ambiguous: 2 });
	});

	it("refuses two candidates with the same series and numbers", () => {
		expect(
			planWatchedUnion({
				plex: [inShow("p1", regular(1, 1), { watched: true })],
				jellyfin: [inShow("j1", regular(1, 1)), inShow("j2", regular(1, 1))],
			}),
		).toMatchObject({ writes: [], matched: 0, unmatched: 0, ambiguous: 3 });
	});

	it("refuses equal numbers when the episode IDs conflict", () => {
		expect(
			planWatchedUnion({
				plex: [
					inShow("p1", regular(1, 1), {
						watched: true,
						ids: [{ provider: "tvdb", value: "349232" }],
					}),
				],
				jellyfin: [
					inShow("j1", regular(1, 1), {
						ids: [{ provider: "tvdb", value: "349233" }],
					}),
				],
			}),
		).toMatchObject({ writes: [], matched: 0, unmatched: 0, ambiguous: 2 });
	});

	it("pairs by an exact episode ID before equal numbers", () => {
		const pilotId: MediaItem["ids"] = [{ provider: "tvdb", value: "349232" }];
		expect(
			planWatchedUnion({
				plex: [
					inShow("p1", regular(1, 1), { watched: true, ids: pilotId }),
					inShow("p2", regular(1, 2)),
				],
				jellyfin: [
					inShow("j1", regular(1, 2), { ids: pilotId }),
					inShow("j2", regular(1, 1)),
				],
			}),
		).toEqual({
			writes: [
				{ kind: "watched", target: "jellyfin", itemId: "j1", title: "j1" },
			],
			matched: 1,
			unmatched: 2,
			ambiguous: 0,
			positionConflicts: 0,
			...NO_SKIP_REASONS,
			pairs: [{ plexItemId: "p1", jellyfinItemId: "j1", source: "exactIds" }],
			missingEpisodeIds: 2,
		});
	});

	it("separates a missing series ID from a missing episode ID", () => {
		expect(
			planWatchedUnion({
				plex: [inShow("p1", regular(1, 1), { series: {} })],
				jellyfin: [inShow("j1", regular(1, 1))],
			}),
		).toMatchObject({
			matched: 0,
			unmatched: 2,
			missingSeriesIds: 1,
			missingEpisodeIds: 1,
		});
	});

	it("plans the same result for any input order", () => {
		const plex = [
			inShow("p1", regular(1, 1), { watched: true }),
			inShow("p2", regular(1, 2)),
			inShow("p3", regular(1, 3), { watched: true }),
			inShow("p4", { kind: "special", episodes: { first: 1, count: 1 } }),
		];
		const jellyfin = [
			inShow("j1", regular(1, 1)),
			inShow("j2", regular(1, 2), { watched: true }),
			inShow("j3", regular(1, 3)),
			inShow("j3-copy", regular(1, 3)),
		];
		const summarize = (plan: ReturnType<typeof planWatchedUnion>) => ({
			...plan,
			writes: plan.writes.map((write) => write.itemId).sort(),
			pairs: [...plan.pairs].sort((a, b) =>
				a.plexItemId.localeCompare(b.plexItemId),
			),
		});
		const expected = {
			writes: ["j1", "p2"],
			matched: 2,
			unmatched: 0,
			ambiguous: 4,
			positionConflicts: 0,
			...NO_SKIP_REASONS,
			pairs: [
				{ plexItemId: "p1", jellyfinItemId: "j1", source: "seriesNumber" },
				{ plexItemId: "p2", jellyfinItemId: "j2", source: "seriesNumber" },
			],
			unsupportedNumbering: 1,
		} satisfies ReturnType<typeof summarize>;
		const plan = planWatchedUnion({ plex, jellyfin });
		expect(2 * plan.matched + plan.unmatched + plan.ambiguous).toBe(
			plex.length + jellyfin.length,
		);
		expect(summarize(plan)).toEqual(expected);
		expect(
			summarize(
				planWatchedUnion({
					plex: [...plex].reverse(),
					jellyfin: [...jellyfin].reverse(),
				}),
			),
		).toEqual(expected);
	});

	it("keeps a saved manual match ahead of equal numbers", () => {
		expect(
			planWatchedUnion({
				plex: [inShow("p1", regular(1, 1), { watched: true })],
				jellyfin: [inShow("j1", regular(1, 1)), inShow("j2", regular(1, 2))],
				manualMatches: [
					{ pairingId: "person", plexItemId: "p1", jellyfinItemId: "j2" },
				],
			}),
		).toMatchObject({
			writes: [
				{ kind: "watched", target: "jellyfin", itemId: "j2", title: "j2" },
			],
			matched: 1,
			unmatched: 1,
			ambiguous: 0,
		});
	});
});

describe("manual watched-union matches", () => {
	it("uses a manual pair before metadata and reserves both items", () => {
		const ids: MediaItem["ids"] = [{ provider: "tmdb", value: "123" }];
		expect(
			planWatchedUnion({
				plex: [movie("p1", true, ids), movie("p2", true, [])],
				jellyfin: [movie("j1", false, ids), movie("j2", false, [])],
				manualMatches: [
					{ pairingId: "person", plexItemId: "p1", jellyfinItemId: "j2" },
				],
			}),
		).toEqual({
			writes: [
				{ kind: "watched", target: "jellyfin", itemId: "j2", title: "j2" },
			],
			matched: 1,
			unmatched: 2,
			ambiguous: 0,
			positionConflicts: 0,
			...NO_SKIP_REASONS,
			pairs: [{ plexItemId: "p1", jellyfinItemId: "j2", source: "manual" }],
			staleManualMatches: 0,
		});
	});
	it("reserves a surviving manual item when its counterpart disappears", () => {
		const ids: MediaItem["ids"] = [{ provider: "tvdb", value: "123" }];
		expect(
			planWatchedUnion({
				plex: [episode("p1", true, ids)],
				jellyfin: [episode("replacement", false, ids)],
				manualMatches: [
					{ pairingId: "person", plexItemId: "p1", jellyfinItemId: "missing" },
				],
			}),
		).toEqual({
			writes: [],
			matched: 0,
			unmatched: 2,
			ambiguous: 0,
			positionConflicts: 0,
			...NO_SKIP_REASONS,
			pairs: [],
			missingSeriesIds: 1,
			staleManualMatches: 1,
		});
	});
});

describe("watch-history policy", () => {
	const ids: MediaItem["ids"] = [{ provider: "imdb", value: "tt1" }];
	function planHistory(input: {
		plex: MediaItem["history"];
		jellyfin: MediaItem["history"];
		plexWatched?: boolean;
		jellyfinWatched?: boolean;
	}) {
		const { writes, matched, positionConflicts } = planWatchedUnion({
			plex: [movie("p1", input.plexWatched ?? false, ids, "p1", input.plex)],
			jellyfin: [
				movie("j1", input.jellyfinWatched ?? false, ids, "j1", input.jellyfin),
			],
		});
		return { writes, matched, positionConflicts };
	}

	it("writes the later Plex position when Plex played over a minute later", () => {
		expect(
			planHistory({
				plex: { lastPlayedAt: 160_001, positionMs: 30_000 },
				jellyfin: { lastPlayedAt: 100_000, positionMs: 10_000 },
			}),
		).toEqual({
			writes: [
				{
					kind: "position",
					target: "jellyfin",
					itemId: "j1",
					title: "j1",
					value: 30_000,
					replaces: 10_000,
				},
			],
			matched: 1,
			positionConflicts: 0,
		});
	});

	it("writes the later Jellyfin position even when it is earlier in the file", () => {
		expect(
			planHistory({
				plex: { lastPlayedAt: 100_000, positionMs: 30_000 },
				jellyfin: { lastPlayedAt: 160_001, positionMs: 10_000 },
			}),
		).toEqual({
			writes: [
				{
					kind: "position",
					target: "plex",
					itemId: "p1",
					title: "p1",
					value: 10_000,
					replaces: 30_000,
				},
			],
			matched: 1,
			positionConflicts: 0,
		});
	});

	it("skips and counts a conflict when one timestamp is missing", () => {
		expect(
			planHistory({
				plex: { lastPlayedAt: null, positionMs: 30_000 },
				jellyfin: { lastPlayedAt: 100_000, positionMs: 10_000 },
			}),
		).toEqual({ writes: [], matched: 1, positionConflicts: 1 });
	});

	it("skips and counts a conflict when both timestamps are missing", () => {
		expect(
			planHistory({
				plex: { lastPlayedAt: null, positionMs: 30_000 },
				jellyfin: { lastPlayedAt: null, positionMs: 10_000 },
			}),
		).toEqual({ writes: [], matched: 1, positionConflicts: 1 });
	});

	it("skips and counts a conflict when timestamps are exactly 60 s apart", () => {
		expect(
			planHistory({
				plex: { lastPlayedAt: 160_000, positionMs: 30_000 },
				jellyfin: { lastPlayedAt: 100_000, positionMs: 10_000 },
			}),
		).toEqual({ writes: [], matched: 1, positionConflicts: 1 });
	});

	it("writes a position 5,001 ms away but not one exactly 5 s away", () => {
		const played = { plex: 160_001, jellyfin: 100_000 };
		expect(
			planHistory({
				plex: { lastPlayedAt: played.plex, positionMs: 15_000 },
				jellyfin: { lastPlayedAt: played.jellyfin, positionMs: 10_000 },
			}),
		).toEqual({ writes: [], matched: 1, positionConflicts: 0 });
		expect(
			planHistory({
				plex: { lastPlayedAt: played.plex, positionMs: 15_001 },
				jellyfin: { lastPlayedAt: played.jellyfin, positionMs: 10_000 },
			}).writes,
		).toEqual([
			{
				kind: "position",
				target: "jellyfin",
				itemId: "j1",
				title: "j1",
				value: 15_001,
				replaces: 10_000,
			},
		]);
	});

	it("never writes a zero or null position from the later side", () => {
		for (const positionMs of [0, null]) {
			expect(
				planHistory({
					plex: { lastPlayedAt: 160_001, positionMs },
					jellyfin: { lastPlayedAt: 100_000, positionMs: 30_000 },
				}),
			).toEqual({ writes: [], matched: 1, positionConflicts: 0 });
		}
	});

	it("dates a Jellyfin watched write with the Plex last-played time", () => {
		expect(
			planHistory({
				plex: { lastPlayedAt: 160_001, positionMs: null },
				jellyfin: NO_HISTORY,
				plexWatched: true,
			}).writes,
		).toEqual([
			{
				kind: "watched",
				target: "jellyfin",
				itemId: "j1",
				title: "j1",
				playedAt: 160_001,
			},
		]);
	});

	it("leaves a Jellyfin watched write undated when Plex has no date", () => {
		expect(
			planHistory({ plex: NO_HISTORY, jellyfin: NO_HISTORY, plexWatched: true })
				.writes,
		).toEqual([
			{ kind: "watched", target: "jellyfin", itemId: "j1", title: "j1" },
		]);
	});

	it("leaves a Plex watched write undated", () => {
		expect(
			planHistory({
				plex: NO_HISTORY,
				jellyfin: { lastPlayedAt: 160_001, positionMs: null },
				jellyfinWatched: true,
			}).writes,
		).toEqual([{ kind: "watched", target: "plex", itemId: "p1", title: "p1" }]);
	});

	it("emits the watched write before the position write", () => {
		expect(
			planHistory({
				plex: { lastPlayedAt: 160_001, positionMs: 30_000 },
				jellyfin: { lastPlayedAt: 100_000, positionMs: 10_000 },
				plexWatched: true,
			}).writes,
		).toEqual([
			{
				kind: "watched",
				target: "jellyfin",
				itemId: "j1",
				title: "j1",
				playedAt: 160_001,
			},
			{
				kind: "position",
				target: "jellyfin",
				itemId: "j1",
				title: "j1",
				value: 30_000,
				replaces: null,
			},
		]);
	});

	it("plans nothing for a pair whose history already matches", () => {
		const history = { lastPlayedAt: 160_001, positionMs: 30_000 };
		expect(
			planHistory({
				plex: history,
				jellyfin: history,
				plexWatched: true,
				jellyfinWatched: true,
			}),
		).toEqual({ writes: [], matched: 1, positionConflicts: 0 });
	});

	it("counts no conflict for a pair never played on either server", () => {
		expect(planHistory({ plex: NO_HISTORY, jellyfin: NO_HISTORY })).toEqual({
			writes: [],
			matched: 1,
			positionConflicts: 0,
		});
	});

	it("applies the same rules to a manual pair", () => {
		expect(
			planWatchedUnion({
				plex: [
					movie("p1", true, [], "p1", {
						lastPlayedAt: 100_000,
						positionMs: 30_000,
					}),
				],
				jellyfin: [
					movie("j1", false, [], "j1", {
						lastPlayedAt: 160_001,
						positionMs: 10_000,
					}),
				],
				manualMatches: [
					{ pairingId: "person", plexItemId: "p1", jellyfinItemId: "j1" },
				],
			}),
		).toEqual({
			writes: [
				{
					kind: "watched",
					target: "jellyfin",
					itemId: "j1",
					title: "j1",
					playedAt: 100_000,
				},
				{
					kind: "position",
					target: "plex",
					itemId: "p1",
					title: "p1",
					value: 10_000,
					replaces: 30_000,
				},
			],
			matched: 1,
			unmatched: 0,
			ambiguous: 0,
			positionConflicts: 0,
			...NO_SKIP_REASONS,
			pairs: [{ plexItemId: "p1", jellyfinItemId: "j1", source: "manual" }],
			staleManualMatches: 0,
		});
	});
});

describe("saved show numbering", () => {
	const showMatch = {
		pairingId: "person",
		plexShowId: "p-show",
		jellyfinShowId: "j-show",
	};
	const showMatches = [showMatch];
	const plex = (number = 1) =>
		inShow("p1", regular(1, number), {
			localId: "p-show",
			series: {},
			watched: true,
		});
	const jellyfin = (number = 1) =>
		inShow("j1", regular(1, number), { localId: "j-show", series: {} });

	it("pairs regular episodes without series IDs using the saved show identity", () => {
		const plan = planWatchedUnion({
			plex: [plex()],
			jellyfin: [jellyfin()],
			showMatches,
		});
		expect(plan.writes).toEqual([
			{ kind: "watched", target: "jellyfin", itemId: "j1", title: "j1" },
		]);
		expect(plan.matched).toBe(1);
		expect(plan.pairs).toEqual([
			{ plexItemId: "p1", jellyfinItemId: "j1", source: "showMatch" },
		]);
	});

	it("reserves episode manual matches before the show numbering stage", () => {
		const plan = planWatchedUnion({
			plex: [plex()],
			jellyfin: [
				jellyfin(),
				inShow("j2", regular(1, 2), { localId: "j-show", series: {} }),
			],
			showMatches,
			manualMatches: [
				{ pairingId: "person", plexItemId: "p1", jellyfinItemId: "j2" },
			],
		});
		expect(plan.pairs).toEqual([
			{ plexItemId: "p1", jellyfinItemId: "j2", source: "manual" },
		]);
		expect(plan.writes).toEqual([
			{ kind: "watched", target: "jellyfin", itemId: "j2", title: "j2" },
		]);
	});

	it("counts stale show matches and lets survivors use provider series matching", () => {
		const plan = planWatchedUnion({
			plex: [inShow("p1", regular(1, 1), { localId: "p-show", watched: true })],
			jellyfin: [inShow("j1", regular(1, 1), { localId: "replacement" })],
			showMatches,
		});
		expect(plan.staleShowMatches).toBe(1);
		expect(plan.pairs).toEqual([
			{ plexItemId: "p1", jellyfinItemId: "j1", source: "seriesNumber" },
		]);
		expect(plan.writes).toEqual([
			{ kind: "watched", target: "jellyfin", itemId: "j1", title: "j1" },
		]);
	});

	it("does not number-match a third show with the same provider series IDs", () => {
		const plan = planWatchedUnion({
			plex: [inShow("p1", regular(1, 1), { localId: "p-show" })],
			jellyfin: [
				inShow("j1", regular(1, 2), { localId: "j-show" }),
				inShow("third", regular(1, 1), { localId: "third-show" }),
			],
			showMatches,
		});
		expect(plan.pairs).toEqual([]);
		expect(plan.matched).toBe(0);
		expect(plan.unmatched).toBe(3);
	});

	const unsupported: { label: string; numbering: EpisodeNumbering }[] = [
		{
			label: "specials",
			numbering: { kind: "special", episodes: { first: 1, count: 1 } },
		},
		{ label: "multi-episode files", numbering: regular(1, 1, 2) },
	];
	for (const { label, numbering } of unsupported) {
		it(`keeps ${label} in matched shows ambiguous`, () => {
			const plan = planWatchedUnion({
				plex: [inShow("p1", numbering, { localId: "p-show", series: {} })],
				jellyfin: [inShow("j1", numbering, { localId: "j-show", series: {} })],
				showMatches,
			});
			expect(plan.pairs).toEqual([]);
			expect(plan.ambiguous).toBe(2);
			expect(plan.unsupportedNumbering).toBe(2);
			expect(plan.missingSeriesIds).toBe(0);
		});
	}

	it("blocks a show-number pair when episode IDs conflict", () => {
		const plan = planWatchedUnion({
			plex: [
				inShow("p1", regular(1, 1), {
					localId: "p-show",
					ids: [{ provider: "tvdb", value: "1" }],
				}),
			],
			jellyfin: [
				inShow("j1", regular(1, 1), {
					localId: "j-show",
					ids: [{ provider: "tvdb", value: "2" }],
				}),
			],
			showMatches,
		});
		expect(plan.pairs).toEqual([]);
		expect(plan.ambiguous).toBe(2);
		expect(plan.writes).toEqual([]);
	});

	it("uses the confirmed show identity despite conflicting provider series IDs", () => {
		const plan = planWatchedUnion({
			plex: [
				inShow("p1", regular(1, 1), {
					localId: "p-show",
					series: { tvdb: "1" },
				}),
			],
			jellyfin: [
				inShow("j1", regular(1, 1), {
					localId: "j-show",
					series: { tvdb: "2" },
				}),
			],
			showMatches,
		});
		expect(plan.pairs).toEqual([
			{ plexItemId: "p1", jellyfinItemId: "j1", source: "showMatch" },
		]);
	});

	it("keeps exact episode IDs ahead of show numbers", () => {
		const ids: MediaItem["ids"] = [{ provider: "tvdb", value: "1" }];
		const plan = planWatchedUnion({
			plex: [inShow("p1", regular(1, 1), { localId: "p-show", ids })],
			jellyfin: [inShow("j1", regular(1, 2), { localId: "j-show", ids })],
			showMatches,
		});
		expect(plan.pairs).toEqual([
			{ plexItemId: "p1", jellyfinItemId: "j1", source: "exactIds" },
		]);
	});

	it("counts a leftover episode in an active show as missing episode IDs", () => {
		const plan = planWatchedUnion({
			plex: [plex()],
			jellyfin: [jellyfin(2)],
			showMatches,
		});
		expect(plan.unmatched).toBe(2);
		expect(plan.missingEpisodeIds).toBe(2);
		expect(plan.missingSeriesIds).toBe(0);
	});
});

describe("showsInLibrary", () => {
	it("groups episodes by local ID and sorts show titles with an ID tie-breaker", () => {
		const items: MediaItem[] = [
			{
				...inShow("e1", regular(1, 1), { localId: "b" }),
				details: { showTitle: "Alpha" },
			},
			{
				...inShow("e2", regular(1, 2), { localId: "b" }),
				details: { showTitle: "Alpha" },
			},
			{
				...inShow("e3", regular(1, 1), { localId: "a" }),
				details: { showTitle: "Alpha" },
			},
			inShow("e4", regular(1, 1), { localId: "Zulu" }),
			inShow("missing-local-id", regular(1, 1)),
			movie("film", false, []),
		];
		expect(showsInLibrary(items)).toEqual([
			{ id: "a", title: "Alpha", episodeCount: 1 },
			{ id: "b", title: "Alpha", episodeCount: 2 },
			{ id: "Zulu", title: "Zulu", episodeCount: 1 },
		]);
	});
});
