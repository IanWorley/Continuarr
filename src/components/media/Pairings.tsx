import { useState } from "react";
import type { MediaService } from "~/backend/media/service";
import {
	buttonClass,
	ErrorMessage,
	type MediaState,
	responseData,
	secondaryClass,
	useAction,
} from "~/components/media/shared";
import { getApi } from "~/routes/api.$";

const PREVIEW_VISIBLE_LIMIT = 100;
const RECENT_RUN_LIMIT = 5;
type Preview = Awaited<ReturnType<MediaService["preview"]>>;
type SyncRun = MediaState["runs"][number];

const RUN_PRESENTATION = {
	completed: { label: "Completed", className: "text-emerald-300" },
	running: { label: "In progress", className: "text-cyan-200" },
	failed: { label: "Needs attention", className: "text-red-300" },
} satisfies Record<SyncRun["status"], { label: string; className: string }>;

const SKIP_REASONS = [
	{
		count: "unmatched",
		label: "Unmatched items",
		unit: "items",
		explanation:
			"No usable matching counterpart was found. Check provider IDs or add a manual match in Manual matching.",
	},
	{
		count: "ambiguous",
		label: "Ambiguous or conflicting metadata",
		unit: "items",
		explanation:
			"Multiple candidates or conflicting identifiers prevent a safe automatic match. Review provider IDs or choose a manual match in Manual matching.",
	},
	{
		count: "staleManualMatches",
		label: "Unavailable manual matches",
		unit: "saved matches",
		explanation:
			"Saved matches refer to missing or incompatible items. Review saved matches in Manual matching. Available items from these matches may also appear in the unmatched count.",
	},
] satisfies {
	count: keyof Pick<Preview, "unmatched" | "ambiguous" | "staleManualMatches">;
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
		<section aria-labelledby="pairings-heading">
			<h2 id="pairings-heading" className="text-xl font-semibold">
				Pairings and sync
			</h2>
			<p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
				Pair the same person across both servers. If a movie or episode is
				watched on either server, sync marks it watched on the other. Nothing is
				marked unwatched.
			</p>
			{state.running && (
				<p role="status" className="mt-4 text-sm text-cyan-200">
					A sync is running. Results will update automatically.
				</p>
			)}
			<div className="mt-5 space-y-5">
				{state.pairings.map((pair) => (
					<PairingCard
						key={pair.id}
						pair={pair}
						state={state}
						refresh={refresh}
					/>
				))}
			</div>
		</section>
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
		<article className="rounded-2xl border border-slate-700/80 bg-slate-900/60 p-5 sm:p-6">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h3 className="text-lg font-semibold">
						{plex?.name ?? "Plex profile"}
						<span
							aria-hidden="true"
							className="mx-3 font-normal text-slate-500"
						>
							↔
						</span>
						<span className="sr-only"> paired with </span>
						{jellyfin?.name ?? "Jellyfin profile"}
					</h3>
					<p className="mt-1 break-words text-xs text-slate-500">
						Plex · {plex?.serverName} <span className="mx-2">/</span> Jellyfin ·{" "}
						{jellyfin?.url}
					</p>
				</div>
				<label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
					<input
						type="checkbox"
						className="size-4 accent-cyan-300"
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
					Sync automatically every hour
				</label>
			</div>
			{unavailable && (
				<p className="mt-3 text-sm text-amber-200">
					Sync is unavailable because one of these users is missing or no longer
					grants access. Refresh the server connections to check again.
				</p>
			)}
			{pair.automatic && (
				<p className="mt-3 text-xs text-cyan-200">
					Automatic sync is on while Continuarr is running. The first sync may
					start shortly.
				</p>
			)}
			<SnapshotHistory
				pair={pair}
				runs={state.runs}
				accessAvailable={!unavailable}
			/>
			<p className="mt-5 text-sm leading-6 text-slate-400">
				Preview compares both libraries without making changes. Sync checks them
				again before updating watched status. Saved manual matches take
				priority. Other items need a unique matching movie or episode ID or they
				are skipped.
			</p>
			<div className="mt-4 flex flex-wrap gap-3">
				<button
					type="button"
					className={secondaryClass}
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
				</button>
				<button
					type="button"
					className={buttonClass}
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
					Sync watched status now
				</button>
			</div>
			<div className="mt-4 space-y-3">
				<ErrorMessage message={action.error} />
				{action.busy && (
					<p role="status" className="text-sm text-cyan-200">
						Working… Large libraries may take a few minutes.
					</p>
				)}
			</div>
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
			className="mt-5 rounded-xl border border-slate-800 bg-slate-950/60 p-4"
		>
			<h4 className="text-sm font-medium text-slate-200">
				{latest ? "Latest available snapshot" : "No recent snapshot available"}
			</h4>
			{latest ? (
				<>
					<SnapshotRun
						run={latest}
						accessAvailable={accessAvailable}
						announce
					/>
					<details className="mt-3 text-xs leading-5 text-slate-400">
						<summary className="cursor-pointer text-slate-300">
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
									<span className="font-medium text-slate-300">
										{reason.label}.{" "}
									</span>
									{reason.explanation}
								</li>
							))}
						</ul>
					</details>
				</>
			) : (
				<div className="mt-2 space-y-2 text-sm leading-6 text-slate-400">
					<p>No snapshot run is available in the recent history.</p>
					{pair.lastAttemptAt > 0 && (
						<p className="text-xs">
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
				<details className="mt-4 border-t border-slate-800 pt-3">
					<summary className="cursor-pointer text-xs text-slate-300">
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
			<p className="mt-3 text-xs text-slate-500">
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
	const presentation = RUN_PRESENTATION[run.status];
	const finished = run.status !== "running" && run.finishedAt !== null;
	const timestamp =
		run.status === "running"
			? run.startedAt
			: (run.finishedAt ?? run.startedAt);
	return (
		<div role={announce ? "status" : undefined} className="mt-2 space-y-2">
			<div className="flex flex-wrap justify-between gap-2 text-xs">
				<span className={presentation.className}>{presentation.label}</span>
				<span className="text-slate-400">
					{finished ? "Finished" : "Started"}{" "}
					<time dateTime={new Date(timestamp).toISOString()}>
						{new Date(timestamp).toLocaleString()}
					</time>
				</span>
			</div>
			<p className="text-sm text-slate-200">
				{run.status === "running"
					? `${run.applied} watched updates applied; ${run.planned} planned so far`
					: `${run.applied} of ${run.planned} planned watched updates applied`}
			</p>
			<p className="break-words text-sm leading-6 text-slate-400">
				{run.summary}
			</p>
			{run.status === "failed" && (
				<p className="text-sm leading-6 text-amber-200">
					{accessAvailable ? "Check the " : "Restore access through the "}
					<a href="/" className="underline hover:text-amber-100">
						server connections
					</a>
					, then retry sync. A retry reads current watched status before
					applying updates.
				</p>
			)}
		</div>
	);
}

export function PreviewResults({ preview }: { preview: Preview }) {
	return (
		<section
			aria-label="Current preview"
			className="mt-5 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60"
		>
			<div className="border-b border-slate-800 p-4">
				<h4 className="font-medium text-cyan-200">Current preview</h4>
				<p className="mt-2 text-sm text-slate-200">
					{preview.writes.length} proposed watched updates
				</p>
				<p className="mt-1 text-xs leading-5 text-slate-400">
					Preview only. No changes have been applied. Sync reads both libraries
					again.
				</p>
				<dl className="mt-4 grid gap-4 text-xs leading-5 sm:grid-cols-2">
					<div>
						<dt className="font-medium text-slate-300">Matched pairs</dt>
						<dd className="text-slate-400">
							<p className="text-slate-200">{preview.matched} pairs</p>
							<p>
								Items paired by a saved manual match or a unique matching movie
								or episode ID.
							</p>
						</dd>
					</div>
					{SKIP_REASONS.map((reason) => (
						<div key={reason.count}>
							<dt className="font-medium text-slate-300">{reason.label}</dt>
							<dd className="text-slate-400">
								<p className="text-slate-200">
									{preview[reason.count] ?? 0} {reason.unit}
								</p>
								<p>{reason.explanation}</p>
							</dd>
						</div>
					))}
				</dl>
				<p className="mt-3 text-xs leading-5 text-slate-500">
					These counts describe this fresh comparison. Categories can overlap
					and are not a total of skipped items. Review saved matches in{" "}
					<a href="/matches" className="text-cyan-300 underline">
						Manual matching
					</a>
					.
				</p>
			</div>
			{preview.writes.length === 0 ? (
				<p className="p-4 text-sm text-slate-400">
					No watched updates are needed for the items that match.
				</p>
			) : (
				<ul className="max-h-80 divide-y divide-slate-800 overflow-y-auto">
					{preview.writes.slice(0, PREVIEW_VISIBLE_LIMIT).map((write) => (
						<li
							key={`${write.target}:${write.itemId}`}
							className="flex flex-col justify-between gap-1 px-4 py-3 text-sm sm:flex-row sm:gap-4"
						>
							<span className="min-w-0 break-words">
								{write.title || "Untitled item"}
							</span>
							<span className="shrink-0 text-slate-400">
								Mark watched in {write.target === "plex" ? "Plex" : "Jellyfin"}
							</span>
						</li>
					))}
				</ul>
			)}
			{preview.writes.length > PREVIEW_VISIBLE_LIMIT && (
				<p className="border-t border-slate-800 p-4 text-xs text-slate-400">
					Showing the first {PREVIEW_VISIBLE_LIMIT} of {preview.writes.length}{" "}
					updates.
				</p>
			)}
		</section>
	);
}
