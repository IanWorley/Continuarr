import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { z } from "zod";
import {
	type LibraryShow,
	type ManualMatch,
	type MediaItem,
	type ShowMatch,
	showsInLibrary,
} from "~/backend/media/model";
import type { MediaService } from "~/backend/media/service";
import {
	Button,
	cardClass,
	Field,
	inputClass,
	linkClass,
	Notice,
	Page,
	PROVIDER_LABELS,
	type Provider,
	ProviderLabel,
	Section,
} from "~/components/ui";
import { getApi } from "~/routes/api.$";

type Library = Awaited<ReturnType<MediaService["library"]>>;
type ContentKind = MediaItem["kind"] | "show";
const CONTENT_TABS = [
	{ kind: "episode", label: "Episodes" },
	{ kind: "movie", label: "Movies" },
	{ kind: "show", label: "Shows" },
] satisfies { kind: ContentKind; label: string }[];
const errorSchema = z.object({ value: z.object({ error: z.string() }) });
const HTTP_UNAUTHORIZED = 401;
const PAGE_SIZE = 25;
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
		<Page
			title="Manual matching"
			description="Choose the same movie, episode, or show in both libraries and save the pair. Saving does not change watched status. Your saved matches are used by sync, including scheduled sync when enabled."
		>
			{state.isPending && (
				<p role="status" className="text-sm text-muted">
					Loading people…
				</p>
			)}
			{state.error && <Notice tone="danger">{state.error.message}</Notice>}
			{state.data && (
				<>
					{!state.data.pairings.length ? (
						<p className="text-sm text-muted">
							Connect Plex and Jellyfin and pair a person on the{" "}
							<Link to="/users" className={linkClass}>
								users page
							</Link>{" "}
							first.
						</p>
					) : (
						<Field label="Person pairing" className="max-w-xl">
							<select
								className={inputClass}
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
						</Field>
					)}
					{pairingId && (
						<PairingMatches key={pairingId} pairingId={pairingId} />
					)}
				</>
			)}
		</Page>
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
	const [kind, setKind] = useState<ContentKind>("episode");
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
		<>
			<div role="tablist" aria-label="Content" className="flex flex-wrap gap-2">
				{CONTENT_TABS.map((tab) => (
					<Button
						key={tab.kind}
						role="tab"
						variant={kind === tab.kind ? "primary" : "secondary"}
						aria-selected={kind === tab.kind}
						onClick={() => {
							setKind(tab.kind);
							setPlexId("");
							setJellyfinId("");
							save.reset();
							setPendingRemoval(null);
						}}
					>
						{tab.label}
					</Button>
				))}
			</div>
			{kind === "show" ? (
				<>
					{library.isFetching && (
						<p role="status" className="text-sm text-muted">
							Reading both libraries…
						</p>
					)}
					{library.error && (
						<Notice tone="danger">{library.error.message}</Notice>
					)}
					{library.data && (
						<ShowMatches
							pairingId={pairingId}
							library={library.data}
							reloading={library.isFetching}
							onChanged={async () => {
								await client.invalidateQueries({ queryKey });
							}}
							onReload={() => {
								void library.refetch();
							}}
						/>
					)}
				</>
			) : (
				<>
					<Section
						id="choose-pair-heading"
						title="Choose a pair"
						actions={
							<Button
								variant="ghost"
								disabled={library.isFetching || save.isPending}
								onClick={() => {
									setPlexId("");
									setJellyfinId("");
									save.reset();
									void library.refetch();
								}}
							>
								Reload libraries
							</Button>
						}
					>
						{library.isFetching && (
							<p role="status" className="text-sm text-muted">
								Reading both libraries…
							</p>
						)}
						{library.error && (
							<Notice tone="danger">{library.error.message}</Notice>
						)}
						{library.data && (
							<>
								<div className="grid gap-4 md:grid-cols-2">
									<LibraryPicker
										key={`${kind}-plex`}
										kind={kind}
										library={library.data}
										provider="plex"
										items={library.data.plex}
										reserved={
											new Set(
												library.data.matches.map((match) => match.plexItemId),
											)
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
										key={`${kind}-jellyfin`}
										kind={kind}
										library={library.data}
										provider="jellyfin"
										items={library.data.jellyfin}
										reserved={
											new Set(
												library.data.matches.map(
													(match) => match.jellyfinItemId,
												),
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
									<div className="space-y-2 rounded-md border border-line bg-raised p-4 text-sm">
										<p>
											Selected pair: {p.title || "Untitled"} /{" "}
											{j.title || "Untitled"}
										</p>
										<p className="text-muted">
											Confirm these are the same {p.kind}. Metadata and
											filenames are shown for your review. No automatic match is
											suggested.
										</p>
									</div>
								)}
								<Button
									variant="primary"
									disabled={
										!p ||
										!j ||
										save.isPending ||
										remove.isPending ||
										library.isFetching ||
										library.isError
									}
									onClick={() => save.mutate()}
								>
									{save.isPending ? "Saving…" : "Save manual match"}
								</Button>
								{save.error && (
									<Notice tone="danger">{save.error.message}</Notice>
								)}
								{save.isSuccess && (
									<Notice tone="success">
										Manual match saved. Watched status has not changed.
									</Notice>
								)}
								{remove.error && (
									<Notice tone="danger">{remove.error.message}</Notice>
								)}
							</>
						)}
					</Section>
					{library.data && (
						<Section
							id="saved-matches-heading"
							title={`Saved matches (${library.data.matches.length})`}
						>
							{!library.data.matches.length && (
								<p className="text-sm text-muted">
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
										className={`${cardClass} space-y-4 p-5`}
									>
										<div className="grid gap-4 md:grid-cols-2">
											<div>
												<p className="mb-2 text-xs font-medium text-muted">
													<ProviderLabel provider="plex" />
												</p>
												{plex ? (
													<ItemDetails item={plex} />
												) : (
													<p className="text-sm">
														Unavailable item ({match.plexItemId})
													</p>
												)}
											</div>
											<div>
												<p className="mb-2 text-xs font-medium text-muted">
													<ProviderLabel provider="jellyfin" />
												</p>
												{jellyfin ? (
													<ItemDetails item={jellyfin} />
												) : (
													<p className="text-sm">
														Unavailable item ({match.jellyfinItemId})
													</p>
												)}
											</div>
										</div>
										{pendingRemoval?.plexItemId === match.plexItemId ? (
											<div className="space-y-3 rounded-md border border-line bg-raised p-4 text-sm">
												<p>
													Remove this saved match? Watched status will stay as
													it is. Future sync may match these items using
													metadata.
												</p>
												<div className="flex flex-wrap gap-3">
													<Button
														variant="danger"
														disabled={remove.isPending || save.isPending}
														onClick={() => remove.mutate(match)}
													>
														Confirm removal
													</Button>
													<Button
														disabled={remove.isPending}
														onClick={() => setPendingRemoval(null)}
													>
														Cancel
													</Button>
												</div>
											</div>
										) : (
											<Button
												disabled={remove.isPending || save.isPending}
												onClick={() => {
													setPendingRemoval(match);
													remove.reset();
												}}
											>
												Remove match
											</Button>
										)}
										{(!plex || !jellyfin || plex.kind !== jellyfin.kind) && (
											<Notice tone="warning">
												This match is unavailable and will be skipped during
												sync.
											</Notice>
										)}
									</div>
								);
							})}
							<p className="text-sm text-muted">
								To sync watched status, return to{" "}
								<Link to="/users" className={linkClass}>
									Users
								</Link>{" "}
								and preview the changes. Sync marks an item watched when either
								side is watched.
							</p>
						</Section>
					)}
				</>
			)}
		</>
	);
}
function showKey(item: MediaItem) {
	return item.kind === "episode" ? (item.episode.series.localId ?? "") : "";
}
function LibraryPicker({
	kind,
	library,
	provider,
	items,
	reserved,
	selected,
	onSelect,
	disabled,
}: {
	kind: MediaItem["kind"];
	library: Library;
	provider: Provider;
	items: MediaItem[];
	reserved: Set<string>;
	selected: string;
	onSelect: (id: string) => void;
	disabled: boolean;
}) {
	const [show, setShow] = useState("");
	const [season, setSeason] = useState("");
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);
	const resetPage = () => {
		setPage(0);
		if (listRef.current) listRef.current.scrollTop = 0;
	};
	const shows = showsInLibrary(items);
	const otherItems = provider === "plex" ? library.jellyfin : library.plex;
	const otherShows = showsInLibrary(otherItems);
	const savedShows = new Map(
		library.showMatches.map((match) => [
			provider === "plex" ? match.plexShowId : match.jellyfinShowId,
			provider === "plex" ? match.jellyfinShowId : match.plexShowId,
		]),
	);
	const counterpartId = savedShows.get(show);
	const counterpart = otherShows.find((entry) => entry.id === counterpartId);
	const automatic = new Map(
		library.pairs
			.filter((pair) => pair.source === "showMatch")
			.map((pair) => [
				provider === "plex" ? pair.plexItemId : pair.jellyfinItemId,
				provider === "plex" ? pair.jellyfinItemId : pair.plexItemId,
			]),
	);
	const paired = new Set(
		library.pairs.map((pair) =>
			provider === "plex" ? pair.plexItemId : pair.jellyfinItemId,
		),
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
	const lastPage = Math.max(0, Math.ceil(visible.length / PAGE_SIZE) - 1);
	const currentPage = Math.min(page, lastPage);
	const start = currentPage * PAGE_SIZE;
	const pageItems = visible.slice(start, start + PAGE_SIZE);
	const changePage = (nextPage: number) => {
		setPage(nextPage);
		onSelect("");
		if (listRef.current) listRef.current.scrollTop = 0;
	};
	return (
		<fieldset disabled={disabled} className={`${cardClass} min-w-0`}>
			<legend className="float-left w-full border-b border-line px-5 py-4 text-sm font-semibold">
				<ProviderLabel provider={provider} />
			</legend>
			<div className="clear-both space-y-3 p-5">
				{kind === "episode" && (
					<div className="grid grid-cols-2 gap-3">
						<Field label="Show">
							<select
								className={inputClass}
								value={show}
								onChange={(event) => {
									setShow(event.target.value);
									setSeason("");
									resetPage();
									onSelect("");
								}}
							>
								<option value="">All shows</option>
								{shows.map(({ id, title }) => (
									<option key={id} value={id}>
										{title}
									</option>
								))}
							</select>
						</Field>
						<Field label="Season">
							<select
								className={inputClass}
								value={season}
								onChange={(event) => {
									setSeason(event.target.value);
									resetPage();
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
						</Field>
					</div>
				)}
				{kind === "episode" && show && counterpartId && (
					<p className="text-sm text-muted">
						Saved counterpart show:{" "}
						{counterpart
							? `${counterpart.title} (${counterpart.id})`
							: `Unavailable show (${counterpartId})`}
					</p>
				)}
				<Field label="Search title or path">
					<input
						className={inputClass}
						value={search}
						onChange={(event) => {
							setSearch(event.target.value);
							resetPage();
							onSelect("");
						}}
					/>
				</Field>
				<div className="flex flex-wrap items-center justify-between gap-3 text-sm">
					<p aria-live="polite" className="text-muted">
						Showing {visible.length ? start + 1 : 0}–{start + pageItems.length}{" "}
						of {visible.length}
					</p>
					<div className="flex gap-1">
						<Button
							variant="ghost"
							aria-label={`Previous ${PROVIDER_LABELS[provider]} results page`}
							disabled={currentPage === 0}
							onClick={() => changePage(currentPage - 1)}
						>
							Previous
						</Button>
						<Button
							variant="ghost"
							aria-label={`Next ${PROVIDER_LABELS[provider]} results page`}
							disabled={currentPage === lastPage}
							onClick={() => changePage(currentPage + 1)}
						>
							Next
						</Button>
					</div>
				</div>
				<div ref={listRef} className="max-h-96 space-y-2 overflow-y-auto">
					{!visible.length && (
						<p className="text-sm text-muted">No items found.</p>
					)}
					{pageItems.map((item) => (
						<label
							key={item.id}
							className={`block rounded-md border p-3 transition ${selected === item.id ? "border-ink bg-raised" : "border-line hover:border-line-strong"}`}
						>
							<div className="flex items-start gap-3">
								<input
									type="radio"
									name={`${provider}-item`}
									aria-label={`${item.title || "Untitled"} (${item.id})`}
									checked={selected === item.id}
									disabled={reserved.has(item.id)}
									onChange={() => onSelect(item.id)}
									className="mt-0.5 accent-ink"
								/>
								<div className="min-w-0">
									<ItemDetails item={item} />
									{automatic.has(item.id) && (
										<p className="mt-2 text-xs text-muted">
											Automatic via show match:{" "}
											{otherItems.find(
												(other) => other.id === automatic.get(item.id),
											)?.title || automatic.get(item.id)}
										</p>
									)}
									{item.kind === "episode" &&
										!reserved.has(item.id) &&
										!paired.has(item.id) &&
										otherShows.some(
											(entry) => entry.id === savedShows.get(showKey(item)),
										) && (
											<p className="mt-2 text-xs text-muted">
												Needs an episode match
											</p>
										)}
									{reserved.has(item.id) && (
										<p className="mt-2 text-xs text-faint">Manually matched</p>
									)}
								</div>
							</div>
						</label>
					))}
				</div>
			</div>
		</fieldset>
	);
}
function ItemDetails({ item }: { item: MediaItem }) {
	return (
		<div className="min-w-0 text-sm">
			<p className="font-medium">{item.title || "Untitled"}</p>
			{item.kind === "episode" && (
				<p className="mt-1 text-muted">
					{item.details?.showTitle ?? "Unknown show"} · Season{" "}
					{item.details?.season ?? "unknown"} · Episode{" "}
					{item.details?.episode ?? "unknown"}
				</p>
			)}
			<p className="mt-1 text-muted">
				{item.watched ? "Watched" : "Unwatched"}
			</p>
			{item.details?.paths?.length ? (
				item.details.paths.map((path) => (
					<p key={path} className="mt-2 break-all font-mono text-xs text-faint">
						{path}
					</p>
				))
			) : (
				<p className="mt-2 text-xs text-faint">
					File path not provided by server
				</p>
			)}
			<p className="mt-2 text-xs text-faint">
				{item.ids.length
					? item.ids.map((id) => `${id.provider}: ${id.value}`).join(" · ")
					: "No metadata IDs provided"}
			</p>
		</div>
	);
}

function ShowMatches({
	pairingId,
	library,
	reloading,
	onChanged,
	onReload,
}: {
	pairingId: string;
	library: Library;
	reloading: boolean;
	onChanged: () => Promise<void>;
	onReload: () => void;
}) {
	const [plexId, setPlexId] = useState("");
	const [jellyfinId, setJellyfinId] = useState("");
	const [pendingRemoval, setPendingRemoval] = useState<ShowMatch | null>(null);
	const save = useMutation({
		mutationFn: async () =>
			responseData(
				await getApi()
					.v1.media.pairings({ id: pairingId })
					["show-matches"].post({
						plexShowId: plexId,
						jellyfinShowId: jellyfinId,
					}),
			),
		onSuccess: async () => {
			setPlexId("");
			setJellyfinId("");
			await onChanged();
		},
	});
	const remove = useMutation({
		mutationFn: async (match: ShowMatch) =>
			responseData(
				await getApi()
					.v1.media.pairings({ id: pairingId })
					["show-matches"].delete({
						plexShowId: match.plexShowId,
						jellyfinShowId: match.jellyfinShowId,
					}),
			),
		onSuccess: async () => {
			setPendingRemoval(null);
			save.reset();
			await onChanged();
		},
	});
	const plex = showsInLibrary(library.plex);
	const jellyfin = showsInLibrary(library.jellyfin);
	const busy = reloading || save.isPending || remove.isPending;
	return (
		<>
			<Section
				id="choose-shows-heading"
				title="Choose a show pair"
				actions={
					<Button
						variant="ghost"
						disabled={busy}
						onClick={() => {
							setPlexId("");
							setJellyfinId("");
							save.reset();
							onReload();
						}}
					>
						Reload libraries
					</Button>
				}
			>
				<div className="grid gap-4 md:grid-cols-2">
					<ShowPicker
						provider="plex"
						shows={plex}
						selected={plexId}
						reserved={
							new Set(library.showMatches.map((match) => match.plexShowId))
						}
						disabled={busy}
						onSelect={(id) => {
							setPlexId(id);
							save.reset();
						}}
					/>
					<ShowPicker
						provider="jellyfin"
						shows={jellyfin}
						selected={jellyfinId}
						reserved={
							new Set(library.showMatches.map((match) => match.jellyfinShowId))
						}
						disabled={busy}
						onSelect={(id) => {
							setJellyfinId(id);
							save.reset();
						}}
					/>
				</div>
				<p className="text-sm text-muted">
					Match the same show to pair regular episodes by season and episode
					number. Episode matches take priority, followed by exact metadata IDs.
				</p>
				<Button
					variant="primary"
					disabled={!plexId || !jellyfinId || busy}
					onClick={() => save.mutate()}
				>
					{save.isPending ? "Saving…" : "Save show match"}
				</Button>
				{save.error && <Notice tone="danger">{save.error.message}</Notice>}
				{save.isSuccess && (
					<Notice tone="success">
						Show match saved. Watched status has not changed.
					</Notice>
				)}
				{remove.error && <Notice tone="danger">{remove.error.message}</Notice>}
			</Section>
			<Section
				id="saved-show-matches-heading"
				title={`Saved show matches (${library.showMatches.length})`}
			>
				{!library.showMatches.length && (
					<p className="text-sm text-muted">
						No show matches saved for this pairing.
					</p>
				)}
				{library.showMatches.map((match) => {
					const p = plex.find((show) => show.id === match.plexShowId);
					const j = jellyfin.find((show) => show.id === match.jellyfinShowId);
					return (
						<div
							key={match.plexShowId}
							className={`${cardClass} space-y-4 p-5`}
						>
							<div className="grid gap-4 md:grid-cols-2">
								<div>
									<ProviderLabel provider="plex" />
									<p className="text-sm">
										{p
											? `${p.title} (${p.id}) · ${p.episodeCount} episodes`
											: `Unavailable show (${match.plexShowId})`}
									</p>
								</div>
								<div>
									<ProviderLabel provider="jellyfin" />
									<p className="text-sm">
										{j
											? `${j.title} (${j.id}) · ${j.episodeCount} episodes`
											: `Unavailable show (${match.jellyfinShowId})`}
									</p>
								</div>
							</div>
							{(!p || !j) && (
								<Notice tone="warning">
									This show match is unavailable and will be skipped during
									sync.
								</Notice>
							)}
							{pendingRemoval?.plexShowId === match.plexShowId ? (
								<div className="space-y-3 rounded-md border border-line bg-raised p-4 text-sm">
									<p>
										Remove this saved show match? Watched status will stay as it
										is. Episodes return to metadata matching.
									</p>
									<div className="flex flex-wrap gap-3">
										<Button
											variant="danger"
											disabled={busy}
											onClick={() => remove.mutate(match)}
										>
											Confirm removal
										</Button>
										<Button
											disabled={busy}
											onClick={() => setPendingRemoval(null)}
										>
											Cancel
										</Button>
									</div>
								</div>
							) : (
								<Button
									disabled={busy}
									onClick={() => {
										setPendingRemoval(match);
										remove.reset();
									}}
								>
									Remove show match
								</Button>
							)}
						</div>
					);
				})}
				<p className="text-sm text-muted">
					Return to{" "}
					<Link to="/users" className={linkClass}>
						Users
					</Link>{" "}
					to preview watched status changes.
				</p>
			</Section>
		</>
	);
}

function ShowPicker({
	provider,
	shows,
	selected,
	reserved,
	disabled,
	onSelect,
}: {
	provider: Provider;
	shows: LibraryShow[];
	selected: string;
	reserved: Set<string>;
	disabled: boolean;
	onSelect: (id: string) => void;
}) {
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);
	const visible = shows.filter((show) =>
		`${show.title} ${show.id}`.toLowerCase().includes(search.toLowerCase()),
	);
	const lastPage = Math.max(0, Math.ceil(visible.length / PAGE_SIZE) - 1);
	const currentPage = Math.min(page, lastPage);
	const start = currentPage * PAGE_SIZE;
	const pageShows = visible.slice(start, start + PAGE_SIZE);
	const changePage = (next: number) => {
		setPage(next);
		onSelect("");
		if (listRef.current) listRef.current.scrollTop = 0;
	};
	return (
		<fieldset disabled={disabled} className={`${cardClass} min-w-0`}>
			<legend className="float-left w-full border-b border-line px-5 py-4 text-sm font-semibold">
				<ProviderLabel provider={provider} />
			</legend>
			<div className="clear-both space-y-3 p-5">
				<Field label="Search show title or ID">
					<input
						className={inputClass}
						value={search}
						onChange={(event) => {
							setSearch(event.target.value);
							changePage(0);
						}}
					/>
				</Field>
				<div className="flex flex-wrap items-center justify-between gap-3 text-sm">
					<p aria-live="polite" className="text-muted">
						Showing {visible.length ? start + 1 : 0}–{start + pageShows.length}{" "}
						of {visible.length}
					</p>
					<div className="flex gap-1">
						<Button
							variant="ghost"
							aria-label={`Previous ${PROVIDER_LABELS[provider]} shows page`}
							disabled={currentPage === 0}
							onClick={() => changePage(currentPage - 1)}
						>
							Previous
						</Button>
						<Button
							variant="ghost"
							aria-label={`Next ${PROVIDER_LABELS[provider]} shows page`}
							disabled={currentPage === lastPage}
							onClick={() => changePage(currentPage + 1)}
						>
							Next
						</Button>
					</div>
				</div>
				<div ref={listRef} className="max-h-96 space-y-2 overflow-y-auto">
					{!visible.length && (
						<p className="text-sm text-muted">No shows found.</p>
					)}
					{pageShows.map((show) => (
						<label
							key={show.id}
							className={`block rounded-md border p-3 transition ${selected === show.id ? "border-ink bg-raised" : "border-line hover:border-line-strong"}`}
						>
							<div className="flex items-start gap-3">
								<input
									type="radio"
									name={`${provider}-show`}
									aria-label={`${show.title} (${show.id})`}
									checked={selected === show.id}
									disabled={reserved.has(show.id)}
									onChange={() => onSelect(show.id)}
									className="mt-0.5 accent-ink"
								/>
								<div className="min-w-0 text-sm">
									<p className="font-medium">{show.title}</p>
									<p className="break-all text-xs text-muted">
										{show.id} · {show.episodeCount} episodes
									</p>
									{reserved.has(show.id) && (
										<p className="mt-2 text-xs text-faint">Show matched</p>
									)}
								</div>
							</div>
						</label>
					))}
				</div>
			</div>
		</fieldset>
	);
}
