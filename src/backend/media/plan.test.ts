import { describe, expect, it } from "bun:test";
import type { MediaItem } from "~/backend/media/model";
import { planWatchedUnion } from "~/backend/media/plan";

function movie(
	id: string,
	watched: boolean,
	ids: MediaItem["ids"],
	title = id,
): MediaItem {
	return { id, kind: "movie", title, ids, watched };
}

function episode(
	id: string,
	watched: boolean,
	ids: MediaItem["ids"],
): MediaItem {
	return { id, kind: "episode", title: id, ids, watched };
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
			writes: [{ target: "jellyfin", itemId: "j1", title: "Film" }],
			matched: 1,
			unmatched: 0,
			ambiguous: 0,
		});
	});

	it("marks only the unwatched Plex item when Jellyfin is watched", () => {
		expect(
			planWatchedUnion({
				plex: [episode("p1", false, [{ provider: "tvdb", value: "10" }])],
				jellyfin: [episode("j1", true, [{ provider: "tvdb", value: "10" }])],
			}).writes,
		).toEqual([{ target: "plex", itemId: "p1", title: "p1" }]);
	});

	it("plans no write when watched states already agree", () => {
		for (const watched of [true, false]) {
			expect(
				planWatchedUnion({
					plex: [movie("p1", watched, [{ provider: "tmdb", value: "8" }])],
					jellyfin: [movie("j1", watched, [{ provider: "tmdb", value: "8" }])],
				}),
			).toEqual({ writes: [], matched: 1, unmatched: 0, ambiguous: 0 });
		}
	});

	it("does not match a movie to an episode with the same external ID", () => {
		expect(
			planWatchedUnion({
				plex: [movie("p1", true, [{ provider: "imdb", value: "tt1" }])],
				jellyfin: [episode("j1", false, [{ provider: "imdb", value: "tt1" }])],
			}),
		).toEqual({ writes: [], matched: 0, unmatched: 2, ambiguous: 0 });
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
		).toEqual({ writes: [], matched: 0, unmatched: 0, ambiguous: 3 });
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
		).toEqual({ writes: [], matched: 0, unmatched: 0, ambiguous: 2 });
	});

	it("does not use titles when external IDs are missing", () => {
		expect(
			planWatchedUnion({
				plex: [movie("p1", true, [], "Same title")],
				jellyfin: [movie("j1", false, [], "Same title")],
			}),
		).toEqual({ writes: [], matched: 0, unmatched: 2, ambiguous: 0 });
	});
});
