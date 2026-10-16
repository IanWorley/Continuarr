import { useState } from "react";
import { MILLISECONDS_PER_SECOND } from "~/backend/media/constants";
import type { MediaService } from "~/backend/media/service";
import {
	ErrorMessage,
	type MediaState,
	responseData,
	useAction,
} from "~/components/media/shared";
import {
	Button,
	cardClass,
	linkClass,
	Notice,
	Section,
	StatusBadge,
	Toggle,
	type Tone,
} from "~/components/ui";
import { getApi } from "~/routes/api.$";

const PREVIEW_VISIBLE_LIMIT = 100;
const RECENT_RUN_LIMIT = 5;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const CLOCK_FIELD_DIGITS = 2;
type Preview = Awaited<ReturnType<MediaService["preview"]>>;
type PreviewWrite = Preview["writes"][number];
type SyncRun = MediaState["runs"][number];
const RUN_STATUS_BADGES = {
	running: { tone: "neutral", label: "In progress" },
	completed: { tone: "success", label: "Completed" },
	failed: { tone: "danger", label: "Needs attention" },
} satisfies Record<SyncRun["status"], { tone: Tone; label: string }>;

const SKIP_REASONS = [
	{
		count: "unmatched",
		label: "Unmatched items",
		unit: "items",
		explanation:
			"No usable matching counterpart was found. Check provider IDs or add a manual match in Manual matching.",
	},
	{
		count: "missingSeriesIds",
		label: "Episodes without a series ID",
		unit: "episodes",
		explanation:
			"The show has no IMDb, TMDb, or TVDb ID on this server, so its episodes match only by an episode ID. Refresh the show's metadata or add a show match in Manual matching. These episodes are also unmatched.",
	},
	{
		count: "missingEpisodeIds",
		label: "Episodes without an episode ID",
		unit: "episodes",
		explanation:
			"The show has a series ID, but the other server has no episode with the same series ID, season, and episode number. Check the episode numbering or add a manual match. These episodes are also unmatched.",
	},
	{
		count: "ambiguous",
		label: "Ambiguous or conflicting metadata",
		unit: "items",
		explanation:
			"Multiple candidates or conflicting identifiers prevent a safe automatic match. Review provider IDs or choose a manual match in Manual matching.",
	},
	{
		count: "unsupportedNumbering",
		label: "Episodes that cannot match by number",
		unit: "episodes",
		explanation:
			"Specials, absolute-numbered episodes, multi-episode files, and episodes without numbers never match by season and episode number. Add a manual match. These episodes are also ambiguous.",
	},
	{
		count: "staleManualMatches",
		label: "Unavailable manual matches",
		unit: "saved matches",
		explanation:
			"Saved matches refer to missing or incompatible items. Review saved matches in Manual matching. Available items from these matches may also appear in the unmatched count.",
	},
	{
		count: "staleShowMatches",
		label: "Unavailable show matches",
		unit: "saved show matches",
		explanation:
			"A saved show match refers to a show with no episodes in one library. Its remaining episodes use metadata matching. Review saved show matches in Manual matching.",
	},
	{
		count: "positionConflicts",
		label: "Resume position conflicts",
		unit: "pairs",
		explanation:
			"Both servers report a different resume position, but neither was clearly played last. A last-played time is missing, or both were played within a minute of each other. Continuarr copies neither position.",
	},
] satisfies {
	count: keyof Pick<
		Preview,
		| "unmatched"
		| "missingSeriesIds"
		| "missingEpisodeIds"
		| "ambiguous"
		| "unsupportedNumbering"
		| "staleManualMatches"
		| "staleShowMatches"
		| "positionConflicts"
	>;
	label: string;
	unit: string;
	explanation: string;
}[];

export function Pairings({
	state,
	refresh,
}: {
	state: MediaState;
	refresh: () => Promise<void>;
}) {
	return (
		<Section
			id="pairings-heading"
			title="Pairings and sync"
			description="Pair the same person across both servers. If a movie or episode is watched on either server, sync marks it watched on the other. Resume positions follow the server that played the item most recently. Nothing is marked unwatched."
		>
			{state.running && (
				<Notice tone="neutral">
					A sync is running. Results will update automatically.
				</Notice>
			)}
			{state.pairings.map((pair) => (
				<PairingCard
					key={pair.id}
					pair={pair}
					state={state}
					refresh={refresh}
				/>
			))}
		</Section>
	);
}

function PairingCard({
	pair,
	state,
	refresh,
}: {
	pair: MediaState["pairings"][number];
	state: MediaState;
	refresh: () => Promise<void>;
}) {
	const action = useAction();
	const [preview, setPreview] = useState<Preview | null>(null);
	const plex = state.plexProfiles.find(
		(profile) => profile.id === pair.plexProfileId,
	);
	const jellyfin = state.jellyfinProfiles.find(
		(profile) => profile.id === pair.jellyfinProfileId,
	);
	const unavailable =
		!plex ||
		plex.presence === "missing" ||
		plex.accessStatus === "unavailable" ||
		!jellyfin?.canSync;
	return (
		<article className={`${cardClass} space-y-4 p-5`}>
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="min-w-0">
					<h3 className="font-semibold">
						{plex?.name ?? "Plex profile"}
						<span aria-hidden="true" className="mx-2 font-normal text-faint">
							↔
						</span>
						<span className="sr-only"> paired with </span>
						{jellyfin?.name ?? "Jellyfin profile"}
					</h3>
					<p className="mt-0.5 break-words text-xs text-faint">
						Plex · {plex?.serverName} <span className="mx-2">/</span> Jellyfin ·{" "}
						{jellyfin?.url}
					</p>
				</div>
				<Toggle
					label="Sync automatically every hour"
					checked={pair.automatic}
					disabled={action.busy}
					onChange={(event) => {
						const enabled = event.target.checked;
						void action.perform(async () => {
							responseData(
								await getApi()
									.v1.media.pairings({ id: pair.id })
									.automatic.post({ enabled }),
							);
							await refresh();
						});
					}}
				/>
			</div>
			{unavailable && (
				<Notice tone="warning">
					Sync is unavailable because one of these users is missing or no longer
					grants access. Refresh the server connections to check again.
				</Notice>
			)}
			{pair.automatic && (
				<p className="text-xs text-faint">
					Automatic sync is on while Continuarr is running. The first sync may
					start shortly.
				</p>
			)}
			<SnapshotHistory
				pair={pair}
				runs={state.runs}
				accessAvailable={!unavailable}
			/>
			<p className="text-sm text-muted">
				Preview compares both libraries without making changes. Sync checks them
				again before applying updates. Saved manual matches take priority. Other
				items need a unique matching movie or episode ID. An episode can also
				match by a shared series ID with the same season and episode number.
				Everything else is skipped.
			</p>
			<div className="flex flex-wrap gap-3">
				<Button
					disabled={action.busy || state.running || unavailable}
					onClick={() =>
						void action.perform(async () => {
							setPreview(
								responseData(
									await getApi()
										.v1.media.pairings({ id: pair.id })
										.preview.post(),
								),
							);
						})
					}
				>
					Preview changes
				</Button>
				<Button
					variant="primary"
					disabled={action.busy || state.running || unavailable}
					onClick={() =>
						void action.perform(async () => {
							responseData(
								await getApi().v1.media.pairings({ id: pair.id }).run.post(),
							);
							setPreview(null);
							await refresh();
						})
					}
				>
					Sync now
				</Button>
			</div>
			<ErrorMessage message={action.error} />
			{action.busy && (
				<Notice tone="neutral">
					Working… Large libraries may take a few minutes.
				</Notice>
			)}
			{preview && <PreviewResults preview={preview} />}
		</article>
	);
}

export function SnapshotHistory({
	pair,
	runs,
	accessAvailable,
}: {
	pair: Pick<MediaState["pairings"][number], "id" | "lastAttemptAt">;
	runs: MediaState["runs"];
	accessAvailable: boolean;
}) {
	const [latest, ...earlier] = runs
		.filter((run) => run.pairingId === pair.id)
		.slice(0, RECENT_RUN_LIMIT);
	return (
		<section
			aria-label="Snapshot sync history"
			className="rounded-md border border-line bg-canvas p-4"
		>
			<h4 className="text-sm font-medium">
				{latest ? "Latest available snapshot" : "No recent snapshot available"}
			</h4>
			{latest ? (
				<>
					<SnapshotRun
						run={latest}
						accessAvailable={accessAvailable}
						announce
					/>
					<details className="mt-3 text-xs text-muted">
						<summary className="cursor-pointer transition hover:text-ink">
							Why items may be skipped
						</summary>
						<p className="mt-2">
							Any recorded skip counts appear in the run summary. Individual
							skipped-item records are not available here. Preview reads the
							current libraries again. These explanations describe categories,
							not the items skipped in this run.
						</p>
						<ul className="mt-2 space-y-2">
							{SKIP_REASONS.map((reason) => (
								<li key={reason.count}>
									<span className="font-medium text-ink">{reason.label}. </span>
									{reason.explanation}
								</li>
							))}
						</ul>
					</details>
				</>
			) : (
				<div className="mt-2 space-y-2 text-sm text-muted">
					<p>No snapshot run is available in the recent history.</p>
					{pair.lastAttemptAt > 0 && (
						<p className="text-xs text-faint">
							Last attempted{" "}
							<time dateTime={new Date(pair.lastAttemptAt).toISOString()}>
								{new Date(pair.lastAttemptAt).toLocaleString()}
							</time>
						</p>
					)}
					<p>
						{accessAvailable
							? "Preview checks the current libraries without saving a run. Sync saves its result here."
							: "Refresh the server connections to restore access before previewing or syncing."}
					</p>
				</div>
			)}
			{earlier.length > 0 && (
				<details className="mt-4 border-t border-line pt-3">
					<summary className="cursor-pointer text-xs text-muted transition hover:text-ink">
						Earlier available runs
					</summary>
					<ul className="mt-3 space-y-4">
						{earlier.map((run) => (
							<li key={run.id}>
								<SnapshotRun run={run} accessAvailable={accessAvailable} />
							</li>
						))}
					</ul>
				</details>
			)}
			<p className="mt-3 text-xs text-faint">
				Only recent available runs are shown.
			</p>
		</section>
	);
}

function SnapshotRun({
	run,
	accessAvailable,
	announce = false,
}: {
	run: SyncRun;
	accessAvailable: boolean;
	announce?: boolean;
}) {
	const badge = RUN_STATUS_BADGES[run.status];
	const finished = run.status !== "running" && run.finishedAt !== null;
	const timestamp =
		run.status === "running"
			? run.startedAt
			: (run.finishedAt ?? run.startedAt);
	return (
		<div role={announce ? "status" : undefined} className="mt-2 space-y-2">
			<div className="flex flex-wrap justify-between gap-2">
				<StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
				<span className="text-xs text-faint">
					{finished ? "Finished" : "Started"}{" "}
					<time dateTime={new Date(timestamp).toISOString()}>
						{new Date(timestamp).toLocaleString()}
					</time>
				</span>
			</div>
			<p className="text-sm">
				{run.status === "running"
					? `${run.applied} updates applied; ${run.planned} planned so far`
					: `${run.applied} of ${run.planned} planned updates applied`}
			</p>
			<p className="break-words text-sm text-muted">{run.summary}</p>
			{run.status === "failed" && (
				<p className="text-sm text-amber-100">
					{accessAvailable ? "Check the " : "Restore access through the "}
					<a href="/" className={linkClass}>
						server connections
					</a>
					, then retry sync. A retry reads both libraries again before applying
					updates.
				</p>
			)}
		</div>
	);
}

function formatPosition(positionMs: number): string {
	const totalSeconds = Math.floor(positionMs / MILLISECONDS_PER_SECOND);
	const totalMinutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
	const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
	const pad = (value: number) =>
		String(value).padStart(CLOCK_FIELD_DIGITS, "0");
	const seconds = pad(totalSeconds % SECONDS_PER_MINUTE);
	return hours > 0
		? `${hours}:${pad(totalMinutes % MINUTES_PER_HOUR)}:${seconds}`
		: `${totalMinutes}:${seconds}`;
}

function WriteLabel({ write }: { write: PreviewWrite }) {
	const server = write.target === "plex" ? "Plex" : "Jellyfin";
	switch (write.kind) {
		case "position":
			return (
				<>
					Resume at {formatPosition(write.value)} on {server}
				</>
			);
		case "watched":
			if (write.target === "plex" || write.playedAt === undefined)
				return <>Mark watched on {server}</>;
			return (
				<>
					Mark watched on {server} (
					<time dateTime={new Date(write.playedAt).toISOString()}>
						{new Date(write.playedAt).toLocaleDateString()}
					</time>
					)
				</>
			);
	}
}

export function PreviewResults({ preview }: { preview: Preview }) {
	const watched = preview.writes.filter(
		(write) => write.kind === "watched",
	).length;
	const positions = preview.writes.length - watched;
	return (
		<section
			aria-label="Current preview"
			className="overflow-hidden rounded-md border border-line bg-canvas"
		>
			<div className="border-b border-line px-4 py-3">
				<h4 className="text-sm font-medium">Current preview</h4>
				<p className="mt-1 text-sm">
					{preview.writes.length} proposed updates ({watched} watched,{" "}
					{positions} positions)
				</p>
				<p className="mt-0.5 text-xs text-faint">
					Preview only. No changes have been applied. Sync reads both libraries
					again.
				</p>
				<dl className="mt-4 grid gap-4 text-xs sm:grid-cols-2">
					<div>
						<dt className="font-medium text-ink">Matched pairs</dt>
						<dd className="text-muted">
							<p className="text-ink">{preview.matched} pairs</p>
							<p>
								Items paired by a saved manual match, a unique matching movie or
								episode ID, or a saved show match or shared series ID with the
								same season and episode number.
							</p>
						</dd>
					</div>
					{SKIP_REASONS.map((reason) => (
						<div key={reason.count}>
							<dt className="font-medium text-ink">{reason.label}</dt>
							<dd className="text-muted">
								<p className="text-ink">
									{preview[reason.count] ?? 0} {reason.unit}
								</p>
								<p>{reason.explanation}</p>
							</dd>
						</div>
					))}
				</dl>
				<p className="mt-3 text-xs text-faint">
					These counts describe this fresh comparison. Categories can overlap
					and are not a total of skipped items. Review saved matches in{" "}
					<a href="/matches" className={linkClass}>
						Manual matching
					</a>
					.
				</p>
			</div>
			{preview.writes.length === 0 ? (
				<p className="px-4 py-3 text-sm text-muted">
					No updates are needed for the items that match.
				</p>
			) : (
				<ul className="max-h-80 divide-y divide-line overflow-y-auto">
					{preview.writes.slice(0, PREVIEW_VISIBLE_LIMIT).map((write) => (
						<li
							key={`${write.kind}:${write.target}:${write.itemId}`}
							className="flex flex-col justify-between gap-1 px-4 py-3 text-sm sm:flex-row sm:gap-4"
						>
							<span className="min-w-0 break-words">
								{write.title || "Untitled item"}
							</span>
							<span className="shrink-0 text-muted">
								<WriteLabel write={write} />
							</span>
						</li>
					))}
				</ul>
			)}
			{preview.writes.length > PREVIEW_VISIBLE_LIMIT && (
				<p className="border-t border-line px-4 py-3 text-xs text-faint">
					Showing the first {PREVIEW_VISIBLE_LIMIT} of {preview.writes.length}{" "}
					updates.
				</p>
			)}
		</section>
	);
}
