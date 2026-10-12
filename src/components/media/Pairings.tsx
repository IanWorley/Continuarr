import { useState } from "react";
import type { MediaService } from "~/backend/media/service";
import {
	ErrorMessage,
	formatTimestamp,
	type MediaState,
	responseData,
	useAction,
} from "~/components/media/shared";
import {
	Button,
	Notice,
	ProviderLabel,
	StatusBadge,
	Toggle,
	type Tone,
} from "~/components/ui";
import { getApi } from "~/routes/api.$";

const PREVIEW_VISIBLE_LIMIT = 100;
const RECENT_RUN_LIMIT = 5;
type Preview = Awaited<ReturnType<MediaService["preview"]>>;
type Run = MediaState["runs"][number];

const RUN_STATUS = {
	failed: { tone: "danger", label: "Needs attention" },
	running: { tone: "neutral", label: "In progress" },
	completed: { tone: "success", label: "Completed" },
} satisfies Record<Run["status"], { tone: Tone; label: string }>;

export function PairingRow({
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
	const blocked = action.busy || state.running || unavailable;
	return (
		<li className="grid gap-4 px-5 py-5">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="min-w-0">
					<h3 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium">
						<ProviderLabel provider="plex">
							{plex?.name ?? "Plex profile"}
						</ProviderLabel>
						<span aria-hidden="true" className="text-faint">
							↔
						</span>
						<span className="sr-only"> paired with </span>
						<ProviderLabel provider="jellyfin">
							{jellyfin?.name ?? "Jellyfin profile"}
						</ProviderLabel>
					</h3>
					<p className="mt-1 font-mono text-xs break-all text-faint">
						{plex?.serverName ?? "Unknown Plex server"} · {jellyfin?.url}
					</p>
				</div>
				<StatusBadge
					tone={
						unavailable ? "warning" : pair.automatic ? "success" : "neutral"
					}
				>
					{unavailable
						? "Sync unavailable"
						: pair.automatic
							? "Syncing hourly"
							: "Manual sync"}
				</StatusBadge>
			</div>
			{unavailable && (
				<Notice tone="warning">
					One of these users is missing or no longer grants access. Refresh your
					server connections to check again.
				</Notice>
			)}
			<div className="flex flex-wrap items-center gap-3">
				<Button
					disabled={blocked}
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
					disabled={blocked}
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
				<div className="sm:ml-auto">
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
			</div>
			<ErrorMessage message={action.error} />
			{action.busy && (
				<p role="status" className="text-sm text-muted">
					Working… Large libraries may take a few minutes.
				</p>
			)}
			{result && <Notice tone="neutral">{result}</Notice>}
			{preview && <PreviewResults preview={preview} />}
			{recentRuns.length > 0 && (
				<section aria-label="Recent sync runs">
					<h4 className="text-xs font-medium text-faint">Recent runs</h4>
					<ul className="mt-2 divide-y divide-line rounded-md border border-line">
						{recentRuns.map((run) => (
							<li
								key={run.id}
								className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-[9rem_1fr_auto] sm:items-baseline sm:gap-4"
							>
								<StatusBadge tone={RUN_STATUS[run.status].tone}>
									{RUN_STATUS[run.status].label}
								</StatusBadge>
								<span className="min-w-0 text-muted">{run.summary}</span>
								<time
									dateTime={new Date(run.startedAt).toISOString()}
									className="text-xs whitespace-nowrap text-faint"
								>
									{formatTimestamp(run.startedAt)}
								</time>
							</li>
						))}
					</ul>
				</section>
			)}
		</li>
	);
}

function PreviewResults({ preview }: { preview: Preview }) {
	return (
		<section
			aria-label="Preview results"
			className="overflow-hidden rounded-md border border-line bg-canvas"
		>
			<div className="border-b border-line px-4 py-3">
				<p className="text-sm font-medium">
					{preview.writes.length} watched updates
				</p>
				<p className="mt-0.5 text-xs text-faint">
					{preview.matched} matched pairs · {preview.unmatched} unmatched items
					· {preview.ambiguous} ambiguous items skipped
					{Boolean(preview.staleManualMatches) && (
						<>
							{" "}
							· {preview.staleManualMatches} unavailable manual matches skipped
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
							className="flex flex-col justify-between gap-1 px-4 py-2 text-sm sm:flex-row sm:gap-4"
						>
							<span className="min-w-0 break-words">
								{write.title || "Untitled item"}
							</span>
							<span className="shrink-0 text-xs text-muted">
								Mark watched in <ProviderLabel provider={write.target} />
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
