import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { MediaService } from "~/backend/media/service";
import { Pairings, PreviewResults, SnapshotHistory } from "./Pairings";
import type { MediaState } from "./shared";

type SyncRun = MediaState["runs"][number];
type Preview = Awaited<ReturnType<MediaService["preview"]>>;

const STARTED_AT = Date.parse("2026-10-12T12:00:00.000Z");
const FINISHED_AT = Date.parse("2026-10-12T12:01:00.000Z");
const PAIR = {
	id: "pair-a",
	plexProfileId: "plex-a",
	jellyfinProfileId: "jellyfin-a",
	automatic: false,
	lastAttemptAt: STARTED_AT,
} satisfies MediaState["pairings"][number];

function completedRun(overrides: Partial<SyncRun> = {}): SyncRun {
	return {
		id: "run-a",
		pairingId: "pair-a",
		status: "completed",
		startedAt: STARTED_AT,
		finishedAt: FINISHED_AT,
		planned: 3,
		applied: 3,
		summary:
			"3 updates completed. 3 matched pairs; 2 unmatched items; 1 ambiguous items skipped. 1 unavailable manual matches skipped.",
		...overrides,
	};
}

function mediaState(overrides: Partial<MediaState> = {}): MediaState {
	return {
		activePlexAccountId: null,
		accounts: [],
		plexServers: [],
		directoryPolling: {
			enabled: false,
			intervalMinutes: 60,
			nextAttemptAt: 0,
			lastAttemptAt: null,
		},
		plexProfiles: [],
		jellyfinProfiles: [],
		pairings: [PAIR],
		runs: [],
		running: false,
		...overrides,
	};
}

function preview(overrides: Partial<Preview> = {}): Preview {
	return {
		pairs: [],
		staleShowMatches: 0,
		writes: [],
		matched: 0,
		unmatched: 0,
		ambiguous: 0,
		missingSeriesIds: 0,
		missingEpisodeIds: 0,
		unsupportedNumbering: 0,
		staleManualMatches: 0,
		positionConflicts: 0,
		...overrides,
	};
}

describe("snapshot sync history", () => {
	test("promotes a completed snapshot with finish time, counts and recorded skips", () => {
		const html = renderToStaticMarkup(
			<SnapshotHistory pair={PAIR} runs={[completedRun()]} accessAvailable />,
		);

		expect(html).toContain("Latest available snapshot");
		expect(html).toContain("Completed");
		expect(html).toContain(
			'Finished <time dateTime="2026-10-12T12:01:00.000Z"',
		);
		expect(html).toContain("3 of 3 planned updates applied");
		expect(html).toContain(
			"3 updates completed. 3 matched pairs; 2 unmatched items; 1 ambiguous items skipped. 1 unavailable manual matches skipped.",
		);
		expect(html).toContain('role="status"');
		expect(html).toContain("<summary");
		expect(html).toContain("Why items may be skipped");
		expect(html).toContain(
			"Any recorded skip counts appear in the run summary.",
		);
		expect(html).toContain("Preview reads the current libraries again.");
		expect(html).toContain("not the items skipped in this run.");
	});

	test("keeps a safe failed summary and offers a next step after partial updates", () => {
		const html = renderToStaticMarkup(
			<SnapshotHistory
				pair={PAIR}
				runs={[
					completedRun({
						status: "failed",
						planned: 5,
						applied: 2,
						summary:
							"2 of 5 updates completed. The media server rejected these credentials. A retry reads both libraries again first.",
					}),
				]}
				accessAvailable
			/>,
		);

		expect(html).toContain("Needs attention");
		expect(html).toContain("2 of 5 planned updates applied");
		expect(html).toContain("The media server rejected these credentials.");
		expect(html).toContain('href="/"');
		expect(html).toContain("server connections</a>, then retry sync.");
		expect(html).toContain(
			"A retry reads both libraries again before applying updates.",
		);
	});

	test("preserves interrupted-run recovery advice while current access is unavailable", () => {
		const html = renderToStaticMarkup(
			<SnapshotHistory
				pair={PAIR}
				runs={[
					completedRun({
						status: "failed",
						summary:
							"Server restarted during sync. Run again to reconcile current watched status.",
					}),
				]}
				accessAvailable={false}
			/>,
		);

		expect(html).toContain(
			"Server restarted during sync. Run again to reconcile current watched status.",
		);
		expect(html).toContain("Restore access through the ");
		expect(html).toContain("server connections</a>, then retry sync.");
	});

	test("selects only this pairing and renders the newest row once above earlier history", () => {
		const html = renderToStaticMarkup(
			<SnapshotHistory
				pair={PAIR}
				runs={[
					completedRun({
						id: "other-pair",
						pairingId: "pair-b",
						summary: "Other pairing result.",
					}),
					completedRun({ summary: "Newest pairing result." }),
					...Array.from({ length: 5 }, (_, index) =>
						completedRun({
							id: `earlier-${index}`,
							summary: `Earlier pairing result ${index}.`,
						}),
					),
				]}
				accessAvailable
			/>,
		);

		expect(html.match(/Newest pairing result\./g)).toEqual([
			"Newest pairing result.",
		]);
		expect(html.match(/role="status"/g)).toEqual(['role="status"']);
		expect(html).toContain("Earlier available runs");
		expect(html).toContain("Earlier pairing result 3.");
		expect(html).not.toContain("Other pairing result.");
		expect(html).not.toContain("Earlier pairing result 4.");
		expect(html.indexOf("Newest pairing result.")).toBeLessThan(
			html.indexOf("Earlier available runs"),
		);
	});

	test("labels an attempt when its result is absent from bounded history", () => {
		const html = renderToStaticMarkup(
			<SnapshotHistory pair={PAIR} runs={[]} accessAvailable />,
		);

		expect(html).toContain("No recent snapshot available");
		expect(html).toContain(
			"No snapshot run is available in the recent history.",
		);
		expect(html).toContain(
			'Last attempted <time dateTime="2026-10-12T12:00:00.000Z"',
		);
		expect(html).toContain("Only recent available runs are shown.");
		expect(html).not.toContain("Never synced");
	});

	test("shows no epoch timestamp for a pairing without a recorded attempt", () => {
		const html = renderToStaticMarkup(
			<SnapshotHistory
				pair={{ ...PAIR, lastAttemptAt: 0 }}
				runs={[]}
				accessAvailable={false}
			/>,
		);

		expect(html).toContain(
			"No snapshot run is available in the recent history.",
		);
		expect(html).toContain(
			"Refresh the server connections to restore access before previewing or syncing.",
		);
		expect(html).not.toContain("Last attempted");
		expect(html).not.toContain("1970");
	});

	test("retains the recorded running phase even with a zero-write plan", () => {
		const html = renderToStaticMarkup(
			<SnapshotHistory
				pair={PAIR}
				runs={[
					completedRun({
						status: "running",
						finishedAt: null,
						applied: 0,
						planned: 0,
						summary: "Applying updates.",
					}),
				]}
				accessAvailable
			/>,
		);

		expect(html).toContain("In progress");
		expect(html).toContain("0 updates applied; 0 planned so far");
		expect(html).toContain("Applying updates.");
		expect(html).toContain('Started <time dateTime="2026-10-12T12:00:00.000Z"');
		expect(html).not.toContain("Reading both libraries");
		expect(html).not.toContain("No updates are needed");
	});

	test("labels the start time when a terminal run has no finish time", () => {
		const html = renderToStaticMarkup(
			<SnapshotHistory
				pair={PAIR}
				runs={[completedRun({ finishedAt: null })]}
				accessAvailable
			/>,
		);

		expect(html).toContain("Completed");
		expect(html).toContain('Started <time dateTime="2026-10-12T12:00:00.000Z"');
		expect(html).not.toContain("Finished");
	});

	test("keeps current access warnings separate from a successful historical run", () => {
		const html = renderToStaticMarkup(
			<Pairings
				state={mediaState({ runs: [completedRun()] })}
				refresh={async () => {}}
			/>,
		);

		expect(html).toContain("Completed");
		expect(html).toContain("3 of 3 planned updates applied");
		expect(html).toContain(
			"Sync is unavailable because one of these users is missing or no longer grants access.",
		);
		expect(html).toContain('disabled=""');
	});

	test("a global run does not assign running status to every pairing", () => {
		const html = renderToStaticMarkup(
			<Pairings
				state={mediaState({
					running: true,
					pairings: [PAIR, { ...PAIR, id: "pair-b" }],
					runs: [
						completedRun({
							status: "running",
							finishedAt: null,
							summary: "Reading both libraries.",
						}),
					],
				})}
				refresh={async () => {}}
			/>,
		);

		expect(html).toContain(
			"A sync is running. Results will update automatically.",
		);
		expect(html.match(/In progress/g)).toEqual(["In progress"]);
		expect(html).toContain("No recent snapshot available");
	});
});

describe("current preview", () => {
	test("explains fresh no-write counts, conflicts and overlapping unavailable matches", () => {
		const html = renderToStaticMarkup(
			<PreviewResults
				preview={preview({
					matched: 4,
					unmatched: 6,
					ambiguous: 2,
					missingSeriesIds: 5,
					missingEpisodeIds: 1,
					unsupportedNumbering: 9,
					staleManualMatches: 3,
					staleShowMatches: 2,
					positionConflicts: 17,
				})}
			/>,
		);

		expect(html).toContain("Current preview");
		expect(html).toContain("0 proposed updates (0 watched, 0 positions)");
		expect(html).toContain(
			"Preview only. No changes have been applied. Sync reads both libraries again.",
		);
		expect(html).toContain("4 pairs");
		expect(html).toContain("6 items");
		expect(html).toContain("2 items");
		expect(html).toContain("3 saved matches");
		expect(html).toContain("2 saved show matches");
		expect(html).toContain("Episodes without a series ID");
		expect(html).toContain("5 episodes");
		expect(html).toContain("Episodes without an episode ID");
		expect(html).toContain("1 episodes");
		expect(html).toContain("Episodes that cannot match by number");
		expect(html).toContain("9 episodes");
		expect(html).toContain("Ambiguous or conflicting metadata");
		expect(html).toContain("Multiple candidates or conflicting identifiers");
		expect(html).toContain(
			"Saved matches refer to missing or incompatible items.",
		);
		expect(html).toContain(
			"Available items from these matches may also appear in the unmatched count.",
		);
		expect(html).toContain(
			"Categories can overlap and are not a total of skipped items.",
		);
		expect(html).toContain("Resume position conflicts");
		expect(html).toContain("17 pairs");
		expect(html).toContain('href="/matches"');
		expect(html).toContain("Manual matching");
	});

	test("shows zero skip categories in a healthy preview", () => {
		const html = renderToStaticMarkup(
			<PreviewResults preview={preview({ matched: 2 })} />,
		);

		expect(html).toContain("2 pairs");
		expect(html).toContain("Unmatched items");
		expect(html).toContain("Ambiguous or conflicting metadata");
		expect(html.match(/0 items/g)).toEqual(["0 items", "0 items"]);
		expect(html.match(/0 episodes/g)).toEqual([
			"0 episodes",
			"0 episodes",
			"0 episodes",
		]);
		expect(html).toContain("0 saved matches");
		expect(html).toContain("No updates are needed for the items that match.");
	});

	test("keeps watched proposals and the bounded update list", () => {
		const html = renderToStaticMarkup(
			<PreviewResults
				preview={preview({
					writes: Array.from({ length: 101 }, (_, index) => ({
						kind: "watched",
						target: "jellyfin",
						itemId: `item-${index}`,
						title: `Movie ${index}`,
					})),
				})}
			/>,
		);

		expect(html).toContain("101 proposed updates (101 watched, 0 positions)");
		expect(html).toContain("Mark watched on Jellyfin");
		expect(html).toContain("Movie 99");
		expect(html).not.toContain("Movie 100");
		expect(html).toContain("Showing the first 100 of 101 updates.");
	});

	test("labels position and dated watched proposals by kind", () => {
		const html = renderToStaticMarkup(
			<PreviewResults
				preview={preview({
					writes: [
						{
							kind: "position",
							target: "plex",
							itemId: "p1",
							title: "Arrival",
							value: 2537000,
							replaces: null,
						},
						{
							kind: "position",
							target: "jellyfin",
							itemId: "j2",
							title: "Heat",
							value: 6017000,
							replaces: null,
						},
						{
							kind: "watched",
							target: "jellyfin",
							itemId: "j3",
							title: "Alien",
							playedAt: Date.parse("2024-03-02T12:00:00.000Z"),
						},
						{
							kind: "watched",
							target: "plex",
							itemId: "p4",
							title: "Heat",
							resumeAt: 754000,
						},
					],
				})}
			/>,
		);

		expect(html).toContain("4 proposed updates (2 watched, 2 positions)");
		expect(html).toContain("Mark watched on Plex and resume at 12:34");
		expect(html).toContain("Resume at 42:17 on Plex");
		expect(html).toContain("Resume at 1:40:17 on Jellyfin");
		expect(html).toContain(
			'Mark watched on Jellyfin (<time dateTime="2024-03-02T12:00:00.000Z">',
		);
	});
});
