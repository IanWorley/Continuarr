import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import type { ManualMatch, MediaItem } from "~/backend/media/model";
import { getApi } from "~/routes/api.$";

const fieldClass =
	"mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm";
const buttonClass =
	"rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40";
const errorSchema = z.object({ value: z.object({ error: z.string() }) });
const HTTP_UNAUTHORIZED = 401;
function responseData<T>(response: {
	data: T | null;
	error: unknown;
	status: number;
}): T {
	if (response.status === HTTP_UNAUTHORIZED && typeof window !== "undefined")
		window.location.assign("/sign-in");
	if (response.error || response.data === null) {
		const error = errorSchema.safeParse(response.error);
		throw new Error(
			error.success
				? error.data.value.error
				: "Unable to load or save matching. Please try again.",
		);
	}
	return response.data;
}
export const Route = createFileRoute("/matches")({ component: Matches });
function Matches() {
	const state = useQuery({
		queryKey: ["media-state"],
		queryFn: async () => responseData(await getApi().v1.media.state.get()),
	});
	const [pairingId, setPairingId] = useState("");
	return (
		<main
			id="main-content"
			tabIndex={-1}
			className="mx-auto min-h-screen max-w-6xl px-5 py-10"
		>
			<h1 className="text-3xl font-semibold">Manual matching</h1>
			<p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
				Choose the same movie or episode in both libraries and save the pair.
				Saving does not change watched status. Your saved matches are used by
				sync, including scheduled sync when enabled.
			</p>
			{state.isPending && (
				<p className="mt-6" role="status">
					Loading people…
				</p>
			)}
			{state.error && (
				<p role="alert" className="mt-6 text-red-300">
					{state.error.message}
				</p>
			)}
			{state.data && (
				<>
					{!state.data.pairings.length ? (
						<p className="mt-6">
							Connect Plex and Jellyfin and pair a person on the{" "}
							<Link to="/" className="text-cyan-300 underline">
								connections page
							</Link>{" "}
							first.
						</p>
					) : (
						<label className="mt-6 block max-w-xl text-sm">
							Person pairing
							<select
								className={fieldClass}
								value={pairingId}
								onChange={(event) => setPairingId(event.target.value)}
							>
								<option value="">Choose a pairing</option>
								{state.data.pairings.map((pair) => {
									const plex = state.data.plexProfiles.find(
										(profile) => profile.id === pair.plexProfileId,
									);
									const jellyfin = state.data.jellyfinProfiles.find(
										(profile) => profile.id === pair.jellyfinProfileId,
									);
									return (
										<option key={pair.id} value={pair.id}>
											{plex?.name ?? "Plex"} / {jellyfin?.name ?? "Jellyfin"} (
											{plex?.serverName ?? "Plex server"})
										</option>
									);
								})}
							</select>
						</label>
					)}
					{pairingId && (
						<PairingMatches key={pairingId} pairingId={pairingId} />
					)}
				</>
			)}
		</main>
	);
}
function PairingMatches({ pairingId }: { pairingId: string }) {
	const client = useQueryClient();
	const queryKey = ["manual-library", pairingId];
	const library = useQuery({
		queryKey,
		queryFn: async () =>
			responseData(
				await getApi().v1.media.pairings({ id: pairingId }).library.get(),
			),
	});
	const [plexId, setPlexId] = useState("");
	const [jellyfinId, setJellyfinId] = useState("");
	const save = useMutation({
		mutationFn: async () =>
			responseData(
				await getApi()
					.v1.media.pairings({ id: pairingId })
					.matches.post({ plexItemId: plexId, jellyfinItemId: jellyfinId }),
			),
		onSuccess: async () => {
			setPlexId("");
			setJellyfinId("");
			await client.invalidateQueries({ queryKey });
		},
	});
	const [pendingRemoval, setPendingRemoval] = useState<ManualMatch | null>(
		null,
	);
	const remove = useMutation({
		mutationFn: async (match: ManualMatch) =>
			responseData(
				await getApi().v1.media.pairings({ id: pairingId }).matches.delete({
					plexItemId: match.plexItemId,
					jellyfinItemId: match.jellyfinItemId,
				}),
			),
		onSuccess: async () => {
			setPendingRemoval(null);
			save.reset();
			await client.invalidateQueries({ queryKey });
		},
	});
	const p = library.data?.plex.find((item) => item.id === plexId);
	const j = library.data?.jellyfin.find((item) => item.id === jellyfinId);
	return (
		<section className="mt-8 space-y-5">
			<div className="flex items-center justify-between gap-4">
				<h2 className="text-xl font-semibold">Choose a pair</h2>
				<button
					type="button"
					className="text-sm text-cyan-300 disabled:opacity-40"
					disabled={library.isFetching || save.isPending}
					onClick={() => {
						setPlexId("");
						setJellyfinId("");
						save.reset();
						void library.refetch();
					}}
				>
					Reload libraries
				</button>
			</div>
			{library.isFetching && <p role="status">Reading both libraries…</p>}
			{library.error && (
				<p role="alert" className="text-red-300">
					{library.error.message}
				</p>
			)}
			{library.data && (
				<>
					<div className="grid gap-5 md:grid-cols-2">
						<LibraryPicker
							provider="Plex"
							items={library.data.plex}
							reserved={
								new Set(library.data.matches.map((match) => match.plexItemId))
							}
							selected={plexId}
							onSelect={(id) => {
								setPlexId(id);
								save.reset();
							}}
							disabled={
								save.isPending || remove.isPending || library.isFetching
							}
						/>
						<LibraryPicker
							provider="Jellyfin"
							items={library.data.jellyfin}
							reserved={
								new Set(
									library.data.matches.map((match) => match.jellyfinItemId),
								)
							}
							selected={jellyfinId}
							onSelect={(id) => {
								setJellyfinId(id);
								save.reset();
							}}
							disabled={
								save.isPending || remove.isPending || library.isFetching
							}
						/>
					</div>
					{p && j && (
						<div className="rounded-lg border border-slate-700 p-4 text-sm">
							<p>
								Selected pair: {p.title || "Untitled"} / {j.title || "Untitled"}
							</p>
							<p className="mt-2 text-slate-400">
								Confirm these are the same {p.kind}. Metadata and filenames are
								shown for your review. No automatic match is suggested.
							</p>
							{p.kind !== j.kind && (
								<p role="alert" className="mt-2 text-red-300">
									Select two movies or two episodes.
								</p>
							)}
						</div>
					)}
					<button
						type="button"
						className={buttonClass}
						disabled={
							!p ||
							!j ||
							p.kind !== j.kind ||
							save.isPending ||
							remove.isPending ||
							library.isFetching ||
							library.isError
						}
						onClick={() => save.mutate()}
					>
						{save.isPending ? "Saving…" : "Save manual match"}
					</button>
					{save.error && (
						<p role="alert" className="text-red-300">
							{save.error.message}
						</p>
					)}
					{save.isSuccess && (
						<p role="status" className="text-cyan-200">
							Manual match saved. Watched status has not changed.
						</p>
					)}
					{remove.error && (
						<p role="alert" className="text-red-300">
							{remove.error.message}
						</p>
					)}
					<h2 className="pt-5 text-xl font-semibold">
						Saved matches ({library.data.matches.length})
					</h2>
					{!library.data.matches.length && (
						<p className="text-sm text-slate-400">
							No manual matches saved for this pairing.
						</p>
					)}
					{library.data.matches.map((match) => {
						const plex = library.data.plex.find(
							(item) => item.id === match.plexItemId,
						);
						const jellyfin = library.data.jellyfin.find(
							(item) => item.id === match.jellyfinItemId,
						);
						return (
							<div
								key={match.plexItemId}
								className="rounded-lg border border-slate-800 p-4"
							>
								<div className="grid gap-4 md:grid-cols-2">
									<div>
										<p className="mb-2 text-xs text-cyan-300">Plex</p>
										{plex ? (
											<ItemDetails item={plex} />
										) : (
											<p>Unavailable item ({match.plexItemId})</p>
										)}
									</div>
									<div>
										<p className="mb-2 text-xs text-cyan-300">Jellyfin</p>
										{jellyfin ? (
											<ItemDetails item={jellyfin} />
										) : (
											<p>Unavailable item ({match.jellyfinItemId})</p>
										)}
									</div>
								</div>
								{pendingRemoval?.plexItemId === match.plexItemId ? (
									<div className="mt-4 space-y-3 text-sm">
										<p>
											Remove this saved match? Watched status will stay as it
											is. Future sync may match these items using metadata.
										</p>
										<div className="flex gap-4">
											<button
												type="button"
												className={buttonClass}
												disabled={remove.isPending || save.isPending}
												onClick={() => remove.mutate(match)}
											>
												Confirm removal
											</button>
											<button
												type="button"
												disabled={remove.isPending}
												onClick={() => setPendingRemoval(null)}
											>
												Cancel
											</button>
										</div>
									</div>
								) : (
									<button
										type="button"
										className="mt-4 text-sm text-cyan-300"
										disabled={remove.isPending || save.isPending}
										onClick={() => {
											setPendingRemoval(match);
											remove.reset();
										}}
									>
										Remove match
									</button>
								)}
								{(!plex || !jellyfin || plex.kind !== jellyfin.kind) && (
									<p className="mt-3 text-sm text-amber-300">
										This match is unavailable and will be skipped during sync.
									</p>
								)}
							</div>
						);
					})}
					<p className="text-sm text-slate-400">
						To sync watched status, return to{" "}
						<Link to="/" className="text-cyan-300 underline">
							connections and sync
						</Link>{" "}
						and preview the changes. Sync marks an item watched when either side
						is watched.
					</p>
				</>
			)}
		</section>
	);
}
function showKey(item: MediaItem) {
	return item.details?.showId ?? item.details?.showTitle ?? "";
}
function LibraryPicker({
	provider,
	items,
	reserved,
	selected,
	onSelect,
	disabled,
}: {
	provider: string;
	items: MediaItem[];
	reserved: Set<string>;
	selected: string;
	onSelect: (id: string) => void;
	disabled: boolean;
}) {
	const [kind, setKind] = useState<MediaItem["kind"]>("episode");
	const [show, setShow] = useState("");
	const [season, setSeason] = useState("");
	const [search, setSearch] = useState("");
	const shows = new Map(
		items
			.filter((item) => item.kind === "episode")
			.map((item) => [
				showKey(item),
				item.details?.showTitle ?? "Unknown show",
			]),
	);
	const seasons = [
		...new Set(
			items
				.filter(
					(item) =>
						item.kind === "episode" && (!show || showKey(item) === show),
				)
				.map((item) => item.details?.season)
				.filter((value) => value !== undefined),
		),
	].sort((a, b) => a - b);
	const visible = items.filter(
		(item) =>
			item.kind === kind &&
			(kind !== "episode" ||
				((!show || showKey(item) === show) &&
					(!season || String(item.details?.season) === season))) &&
			`${item.title} ${item.details?.paths?.join(" ") ?? ""}`
				.toLowerCase()
				.includes(search.toLowerCase()),
	);
	return (
		<fieldset
			disabled={disabled}
			className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/40 p-4"
		>
			<legend className="px-2 text-lg font-semibold">{provider}</legend>
			<label className="block text-sm">
				Content
				<select
					className={fieldClass}
					value={kind}
					onChange={(event) => {
						setKind(event.target.value === "movie" ? "movie" : "episode");
						onSelect("");
					}}
				>
					<option value="episode">Episodes</option>
					<option value="movie">Movies</option>
				</select>
			</label>
			{kind === "episode" && (
				<div className="mt-3 grid grid-cols-2 gap-3">
					<label className="text-sm">
						Show
						<select
							className={fieldClass}
							value={show}
							onChange={(event) => {
								setShow(event.target.value);
								setSeason("");
								onSelect("");
							}}
						>
							<option value="">All shows</option>
							{[...shows]
								.filter(([id]) => id)
								.map(([id, title]) => (
									<option key={id} value={id}>
										{title}
									</option>
								))}
						</select>
					</label>
					<label className="text-sm">
						Season
						<select
							className={fieldClass}
							value={season}
							onChange={(event) => {
								setSeason(event.target.value);
								onSelect("");
							}}
						>
							<option value="">All seasons</option>
							{seasons.map((number) => (
								<option key={number} value={number}>
									Season {number}
								</option>
							))}
						</select>
					</label>
				</div>
			)}
			<label className="mt-3 block text-sm">
				Search title or path
				<input
					className={fieldClass}
					value={search}
					onChange={(event) => {
						setSearch(event.target.value);
						onSelect("");
					}}
				/>
			</label>
			<div className="mt-4 max-h-96 space-y-2 overflow-y-auto">
				{!visible.length && (
					<p className="text-sm text-slate-400">No items found.</p>
				)}
				{visible.map((item) => (
					<label
						key={item.id}
						className={`block rounded-lg border p-3 ${selected === item.id ? "border-cyan-300 bg-cyan-300/5" : "border-slate-800"}`}
					>
						<div className="flex items-start gap-3">
							<input
								type="radio"
								name={`${provider}-item`}
								aria-label={`${item.title || "Untitled"} (${item.id})`}
								checked={selected === item.id}
								disabled={reserved.has(item.id)}
								onChange={() => onSelect(item.id)}
								className="mt-1"
							/>
							<div className="min-w-0">
								<ItemDetails item={item} />
								{reserved.has(item.id) && (
									<p className="mt-2 text-xs text-cyan-300">Manually matched</p>
								)}
							</div>
						</div>
					</label>
				))}
			</div>
		</fieldset>
	);
}
function ItemDetails({ item }: { item: MediaItem }) {
	return (
		<div className="min-w-0 text-sm">
			<p className="font-medium">{item.title || "Untitled"}</p>
			{item.kind === "episode" && (
				<p className="mt-1 text-slate-400">
					{item.details?.showTitle ?? "Unknown show"} · Season{" "}
					{item.details?.season ?? "unknown"} · Episode{" "}
					{item.details?.episode ?? "unknown"}
				</p>
			)}
			<p className="mt-1 text-slate-300">
				{item.watched ? "Watched" : "Unwatched"}
			</p>
			{item.details?.paths?.length ? (
				item.details.paths.map((path) => (
					<p
						key={path}
						className="mt-2 break-all font-mono text-xs text-slate-400"
					>
						{path}
					</p>
				))
			) : (
				<p className="mt-2 text-xs text-slate-400">
					File path not provided by server
				</p>
			)}
			<p className="mt-2 text-xs text-slate-500">
				{item.ids.length
					? item.ids.map((id) => `${id.provider}: ${id.value}`).join(" · ")
					: "No metadata IDs provided"}
			</p>
		</div>
	);
}
