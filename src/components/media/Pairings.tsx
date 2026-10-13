import { useState } from "react";
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
	Notice,
	Section,
	StatusBadge,
	Toggle,
	type Tone,
} from "~/components/ui";
import { getApi } from "~/routes/api.$";

const PREVIEW_VISIBLE_LIMIT = 100;
const RECENT_RUN_LIMIT = 5;
type Preview = Awaited<ReturnType<MediaService["preview"]>>;
type RunStatus = MediaState["runs"][number]["status"];
const RUN_STATUS_BADGES = {
	running: { tone: "neutral", label: "In progress" },
	completed: { tone: "success", label: "Completed" },
	failed: { tone: "danger", label: "Needs attention" },
} satisfies Record<RunStatus, { tone: Tone; label: string }>;

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
			description="Pair the same person across both servers. If a movie or episode is watched on either server, sync marks it watched on the other. Nothing is marked unwatched."
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
	const [result, setResult] = useState("");
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
	const recentRuns = state.runs
		.filter((run) => run.pairingId === pair.id)
		.slice(0, RECENT_RUN_LIMIT);
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
			<p className="text-sm text-muted">
				Preview compares both libraries without making changes. Sync checks them
				again before updating watched status. Saved manual matches take
				priority. Other items need a unique matching movie or episode ID or they
				are skipped.
			</p>
			<div className="flex flex-wrap gap-3">
				<Button
					disabled={action.busy || state.running || unavailable}
					onClick={() =>
						void action.perform(async () => {
							setResult("");
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
							setResult("");
							const run = responseData(
								await getApi().v1.media.pairings({ id: pair.id }).run.post(),
							);
							setResult(run.summary);
							setPreview(null);
							await refresh();
						})
					}
				>
					Sync watched status now
				</Button>
			</div>
			<ErrorMessage message={action.error} />
			{action.busy && (
				<Notice tone="neutral">
					Working… Large libraries may take a few minutes.
				</Notice>
			)}
			{result && <Notice tone="neutral">{result}</Notice>}
			{preview && (
				<section
					aria-label="Preview results"
					className="overflow-hidden rounded-md border border-line bg-canvas"
				>
					<div className="border-b border-line px-4 py-3">
						<p className="text-sm font-medium">
							{preview.writes.length} watched updates
						</p>
						<p className="mt-0.5 text-xs text-faint">
							{preview.matched} matched pairs · {preview.unmatched} unmatched
							items · {preview.ambiguous} ambiguous items skipped
							{Boolean(preview.staleManualMatches) && (
								<>
									{" "}
									· {preview.staleManualMatches} unavailable manual matches
									skipped
								</>
							)}
						</p>
					</div>
					{preview.writes.length === 0 ? (
						<p className="px-4 py-3 text-sm text-muted">
							No watched updates are needed for the items that match.
						</p>
					) : (
						<ul className="max-h-80 divide-y divide-line overflow-y-auto">
							{preview.writes.slice(0, PREVIEW_VISIBLE_LIMIT).map((write) => (
								<li
									key={`${write.target}:${write.itemId}`}
									className="flex flex-col justify-between gap-1 px-4 py-3 text-sm sm:flex-row sm:gap-4"
								>
									<span className="min-w-0 break-words">
										{write.title || "Untitled item"}
									</span>
									<span className="shrink-0 text-muted">
										Mark watched in{" "}
										{write.target === "plex" ? "Plex" : "Jellyfin"}
									</span>
								</li>
							))}
						</ul>
					)}
					{preview.writes.length > PREVIEW_VISIBLE_LIMIT && (
						<p className="border-t border-line px-4 py-3 text-xs text-faint">
							Showing the first {PREVIEW_VISIBLE_LIMIT} of{" "}
							{preview.writes.length} updates.
						</p>
					)}
				</section>
			)}
			{recentRuns.length > 0 && (
				<section
					aria-label="Recent sync runs"
					className="border-t border-line pt-4"
				>
					<h4 className="text-xs font-medium uppercase tracking-wider text-faint">
						Recent runs
					</h4>
					<ul className="mt-3 space-y-3">
						{recentRuns.map((run) => (
							<li key={run.id}>
								<div className="flex flex-wrap justify-between gap-2">
									<StatusBadge tone={RUN_STATUS_BADGES[run.status].tone}>
										{RUN_STATUS_BADGES[run.status].label}
									</StatusBadge>
									<time
										dateTime={new Date(run.startedAt).toISOString()}
										className="text-xs text-faint"
									>
										{new Date(run.startedAt).toLocaleString()}
									</time>
								</div>
								<p className="mt-1 text-sm text-muted">{run.summary}</p>
							</li>
						))}
					</ul>
				</section>
			)}
		</article>
	);
}
