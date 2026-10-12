import { describe, expect, it } from "bun:test";
import type { MediaItem } from "~/backend/media/model";
import { planWatchedUnion } from "~/backend/media/plan";

const NO_HISTORY: MediaItem["history"] = {
	lastPlayedAt: null,
	positionMs: null,
};

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
	history: MediaItem["history"] = NO_HISTORY,
): MediaItem {
	return {
		id,
		kind: "episode",
		title: id,
		ids,
		watched,
		history,
	};
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
				},
			],
			matched: 1,
			unmatched: 0,
			ambiguous: 0,
			positionConflicts: 0,
			staleManualMatches: 0,
		});
	});
});
