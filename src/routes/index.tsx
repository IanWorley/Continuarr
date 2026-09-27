import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import type { MediaService } from "~/backend/media/service";
import { JellyfinConnect } from "~/components/media/JellyfinConnect";
import { PlexConnect } from "~/components/media/PlexConnect";
import {
	buttonClass,
	ErrorMessage,
	fieldClass,
	type MediaState,
	responseData,
	secondaryClass,
	useAction,
} from "~/components/media/shared";
import { getApi } from "~/routes/api.$";

const STATE_REFRESH_MS = 10_000;
const PREVIEW_VISIBLE_LIMIT = 100;
const RECENT_RUN_LIMIT = 5;
const STATE_QUERY_KEY = ["media-state"];
type Preview = Awaited<ReturnType<MediaService["preview"]>>;

const stateQuery = queryOptions({
	queryKey: STATE_QUERY_KEY,
	queryFn: async () => responseData(await getApi().v1.media.state.get()),
	refetchInterval: STATE_REFRESH_MS,
});

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	const state = useQuery(stateQuery);
	const queryClient = useQueryClient();
	const refresh = useCallback(async () => {
		await queryClient.invalidateQueries({ queryKey: STATE_QUERY_KEY });
	}, [queryClient]);
	return (
		<main
			id="main-content"
			tabIndex={-1}
			className="mx-auto min-h-screen w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12"
		>
			<header className="mb-10 flex items-start justify-between gap-6 border-b border-slate-800 pb-7">
				<div>
					<p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
						Your libraries, together
					</p>
					<h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
						Connections &amp; sync
					</h1>
					<p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
						Keep watched movies and episodes in sync between Plex and Jellyfin,
						for each person.
					</p>
				</div>
			</header>
			{state.isPending && (
				<p role="status" className="py-12 text-slate-400">
					Loading your connections…
				</p>
			)}
			{state.isError && (
				<div className="space-y-3">
					<ErrorMessage message={state.error.message} />
					<button
						type="button"
						className={secondaryClass}
						onClick={() => void state.refetch()}
					>
						Try again
					</button>
				</div>
			)}
			{state.data && (
				<div className="space-y-10">
					<section aria-labelledby="connections-heading">
						<div className="mb-5">
							<h2 id="connections-heading" className="text-xl font-semibold">
								1. Connect your profiles
							</h2>
							<p className="mt-1 text-sm text-slate-400">
								Choose the person on each server whose watched history you want
								to sync.
							</p>
						</div>
						<div className="grid gap-5 lg:grid-cols-2">
							<PlexConnect
								key={state.data.activePlexAccountId ?? "unlinked"}
								account={state.data.accounts.find(
									(account) => account.id === state.data.activePlexAccountId,
								)}
								profiles={state.data.plexProfiles}
								refresh={refresh}
							/>
							<JellyfinConnect
								profiles={state.data.jellyfinProfiles}
								refresh={refresh}
							/>
						</div>
					</section>
					<Pairings state={state.data} refresh={refresh} />
				</div>
			)}
		</main>
	);
}

function Pairings({
	state,
	refresh,
}: {
	state: MediaState;
	refresh: () => Promise<void>;
}) {
	const action = useAction();
	const [plexProfileId, setPlexProfileId] = useState("");
	const [jellyfinProfileId, setJellyfinProfileId] = useState("");
	const plexOptions = state.plexProfiles.filter(
		(profile) =>
			!state.pairings.some((pair) => pair.plexProfileId === profile.id),
	);
	const jellyfinOptions = state.jellyfinProfiles.filter(
		(profile) =>
			!state.pairings.some((pair) => pair.jellyfinProfileId === profile.id),
	);
	return (
		<section aria-labelledby="pairings-heading">
			<h2 id="pairings-heading" className="text-xl font-semibold">
				2. Pair people and sync
			</h2>
			<p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
				Pair the same person across both servers. If a movie or episode is
				watched on either server, sync marks it watched on the other. Nothing is
				marked unwatched.
			</p>
			<div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
				{plexOptions.length > 0 && jellyfinOptions.length > 0 ? (
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							void action.perform(async () => {
								responseData(
									await getApi().v1.media.pairings.post({
										plexProfileId,
										jellyfinProfileId,
									}),
								);
								setPlexProfileId("");
								setJellyfinProfileId("");
								await refresh();
							});
						}}
					>
						<div className="grid items-end gap-4 sm:grid-cols-[1fr_1fr_auto]">
							<label
								className="block text-sm text-slate-300"
								htmlFor="pair-plex"
							>
								Plex profile
								<select
									id="pair-plex"
									className={fieldClass}
									required
									value={plexProfileId}
									disabled={action.busy || state.running}
									onChange={(event) => setPlexProfileId(event.target.value)}
								>
									<option value="">Choose a person</option>
									{plexOptions.map((profile) => (
										<option key={profile.id} value={profile.id}>
											{profile.name} · {profile.serverName}
										</option>
									))}
								</select>
							</label>
							<label
								className="block text-sm text-slate-300"
								htmlFor="pair-jellyfin"
							>
								Jellyfin profile
								<select
									id="pair-jellyfin"
									className={fieldClass}
									required
									value={jellyfinProfileId}
									disabled={action.busy || state.running}
									onChange={(event) => setJellyfinProfileId(event.target.value)}
								>
									<option value="">Choose the same person</option>
									{jellyfinOptions.map((profile) => (
										<option key={profile.id} value={profile.id}>
											{profile.name} · {profile.url}
										</option>
									))}
								</select>
							</label>
							<button
								type="submit"
								className={buttonClass}
								disabled={
									action.busy ||
									state.running ||
									!plexProfileId ||
									!jellyfinProfileId
								}
							>
								{action.busy ? "Saving…" : "Create pairing"}
							</button>
						</div>
						<p className="text-xs text-slate-500">
							Each saved profile can belong to one pairing.
						</p>
					</form>
				) : (
					<p className="text-sm text-slate-400">
						{state.pairings.length
							? "Connect another profile on each server to add another person."
							: "Connect a Plex profile and a Jellyfin profile above to create your first pairing."}
					</p>
				)}
				<ErrorMessage message={action.error} />
			</div>
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
	const [result, setResult] = useState("");
	const plex = state.plexProfiles.find(
		(profile) => profile.id === pair.plexProfileId,
	);
	const jellyfin = state.jellyfinProfiles.find(
		(profile) => profile.id === pair.jellyfinProfileId,
	);
	const recentRuns = state.runs
		.filter((run) => run.pairingId === pair.id)
		.slice(0, RECENT_RUN_LIMIT);
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
			{pair.automatic && (
				<p className="mt-3 text-xs text-cyan-200">
					Automatic sync is on while Continuarr is running. The first sync may
					start shortly.
				</p>
			)}
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
					disabled={action.busy || state.running}
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
				</button>
				<button
					type="button"
					className={buttonClass}
					disabled={action.busy || state.running}
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
				</button>
			</div>
			<div className="mt-4 space-y-3">
				<ErrorMessage message={action.error} />
				{action.busy && (
					<p role="status" className="text-sm text-cyan-200">
						Working… Large libraries may take a few minutes.
					</p>
				)}
				{result && (
					<p role="status" className="text-sm text-slate-200">
						{result}
					</p>
				)}
			</div>
			{preview && (
				<section
					aria-label="Preview results"
					className="mt-5 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60"
				>
					<div className="border-b border-slate-800 p-4">
						<p className="font-medium text-cyan-200">
							{preview.writes.length} watched updates
						</p>
						<p className="mt-1 text-xs leading-5 text-slate-400">
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
										Mark watched in{" "}
										{write.target === "plex" ? "Plex" : "Jellyfin"}
									</span>
								</li>
							))}
						</ul>
					)}
					{preview.writes.length > PREVIEW_VISIBLE_LIMIT && (
						<p className="border-t border-slate-800 p-4 text-xs text-slate-400">
							Showing the first {PREVIEW_VISIBLE_LIMIT} of{" "}
							{preview.writes.length} updates.
						</p>
					)}
				</section>
			)}
			{recentRuns.length > 0 && (
				<section
					aria-label="Recent sync runs"
					className="mt-6 border-t border-slate-800 pt-4"
				>
					<h4 className="text-xs font-medium uppercase tracking-wider text-slate-500">
						Recent runs
					</h4>
					<ul className="mt-3 space-y-3">
						{recentRuns.map((run) => (
							<li key={run.id}>
								<div className="flex flex-wrap justify-between gap-2 text-xs">
									<span
										className={
											run.status === "failed"
												? "text-red-300"
												: run.status === "running"
													? "text-cyan-200"
													: "text-emerald-300"
										}
									>
										{run.status === "failed"
											? "Needs attention"
											: run.status === "running"
												? "In progress"
												: "Completed"}
									</span>
									<time
										dateTime={new Date(run.startedAt).toISOString()}
										className="text-slate-500"
									>
										{new Date(run.startedAt).toLocaleString()}
									</time>
								</div>
								<p className="mt-1 text-sm leading-6 text-slate-400">
									{run.summary}
								</p>
							</li>
						))}
					</ul>
				</section>
			)}
		</article>
	);
}
