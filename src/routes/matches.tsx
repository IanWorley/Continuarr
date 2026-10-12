import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import type { ManualMatch, MediaItem } from "~/backend/media/model";
import {
	ErrorMessage,
	mediaStateQuery,
	responseData,
} from "~/components/media/shared";
import {
	Button,
	Field,
	focusRing,
	inputClass,
	Notice,
	Page,
	PROVIDER_LABELS,
	type Provider,
	ProviderLabel,
	StatusBadge,
} from "~/components/ui";
import { getApi } from "~/routes/api.$";

const PAGE_SIZE = 25;
const KIND_OPTIONS = [
	{ value: "episode", label: "Episodes" },
	{ value: "movie", label: "Movies" },
] satisfies { value: MediaItem["kind"]; label: string }[];

export const Route = createFileRoute("/matches")({ component: Matches });

function Matches() {
	const state = useQuery(mediaStateQuery);
	const [pairingId, setPairingId] = useState("");
	return (
		<Page
			title="Manual matching"
			description="Link the same movie or episode when metadata IDs don't line up. Saving a match doesn't change watched status; sync uses it on the next run."
		>
			{state.isPending && (
				<p role="status" className="text-sm text-muted">
					Loading people…
				</p>
			)}
			<ErrorMessage message={state.error?.message ?? ""} />
			{state.data &&
				(!state.data.pairings.length ? (
					<p className="text-sm text-muted">
						Pair a person on{" "}
						<Link to="/users" className="text-ink underline underline-offset-4">
							Users
						</Link>{" "}
						first.
					</p>
				) : (
					<Field label="Pairing" className="max-w-md">
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
										{plex?.name ?? "Plex"} ↔ {jellyfin?.name ?? "Jellyfin"} (
										{plex?.serverName ?? "Plex server"})
									</option>
								);
							})}
						</select>
					</Field>
				))}
			{pairingId && <PairingMatches key={pairingId} pairingId={pairingId} />}
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
	const pickerDisabled =
		save.isPending || remove.isPending || library.isFetching;
	return (
		<>
			<section aria-labelledby="choose-pair-heading" className="space-y-4">
				<div className="flex items-center justify-between gap-4">
					<h2 id="choose-pair-heading" className="text-base font-semibold">
						Choose a pair
					</h2>
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
				</div>
				{library.isFetching && (
					<p role="status" className="text-sm text-muted">
						Reading both libraries…
					</p>
				)}
				<ErrorMessage message={library.error?.message ?? ""} />
				{library.data && (
					<>
						<div className="grid gap-4 lg:grid-cols-2">
							<LibraryPicker
								provider="plex"
								items={library.data.plex}
								reserved={
									new Set(library.data.matches.map((match) => match.plexItemId))
								}
								selected={plexId}
								onSelect={(id) => {
									setPlexId(id);
									save.reset();
								}}
								disabled={pickerDisabled}
							/>
							<LibraryPicker
								provider="jellyfin"
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
								disabled={pickerDisabled}
							/>
						</div>
						<div className="sticky bottom-4 z-10 grid gap-3 rounded-lg border border-line-strong bg-raised/95 px-5 py-4 shadow-2xl shadow-black/50 backdrop-blur">
							<div className="flex flex-wrap items-center justify-between gap-4">
								<p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
									<ProviderLabel provider="plex">
										<span className={p ? "" : "text-faint"}>
											{p ? p.title || "Untitled" : "Select a Plex item"}
										</span>
									</ProviderLabel>
									<span aria-hidden="true" className="text-faint">
										↔
									</span>
									<ProviderLabel provider="jellyfin">
										<span className={j ? "" : "text-faint"}>
											{j ? j.title || "Untitled" : "Select a Jellyfin item"}
										</span>
									</ProviderLabel>
								</p>
								<Button
									variant="primary"
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
								</Button>
							</div>
							{p && j && p.kind !== j.kind && (
								<Notice tone="danger">
									Select two movies or two episodes.
								</Notice>
							)}
							{p && j && p.kind === j.kind && (
								<p className="text-xs text-faint">
									Confirm these are the same {p.kind}. No automatic match is
									suggested.
								</p>
							)}
							<ErrorMessage message={save.error?.message ?? ""} />
							{save.isSuccess && (
								<Notice tone="success">
									Manual match saved. Watched status has not changed.
								</Notice>
							)}
						</div>
					</>
				)}
			</section>
			{library.data && (
				<section
					aria-labelledby="saved-matches-heading"
					className="rounded-lg border border-line bg-surface"
				>
					<header className="border-b border-line px-5 py-4">
						<h2 id="saved-matches-heading" className="text-sm font-semibold">
							Saved matches ({library.data.matches.length})
						</h2>
						<p className="mt-0.5 text-sm text-muted">
							To sync, preview the pairing on{" "}
							<Link
								to="/users"
								className="text-ink underline underline-offset-4"
							>
								Users
							</Link>
							.
						</p>
					</header>
					{remove.error && (
						<div className="border-b border-line px-5 py-3">
							<ErrorMessage message={remove.error.message} />
						</div>
					)}
					{!library.data.matches.length ? (
						<p className="px-5 py-8 text-center text-sm text-faint">
							No manual matches saved for this pairing.
						</p>
					) : (
						<ul className="divide-y divide-line">
							{library.data.matches.map((match) => {
								const plex = library.data.plex.find(
									(item) => item.id === match.plexItemId,
								);
								const jellyfin = library.data.jellyfin.find(
									(item) => item.id === match.jellyfinItemId,
								);
								return (
									<li key={match.plexItemId} className="grid gap-3 px-5 py-4">
										<div className="grid gap-4 md:grid-cols-2">
											<SavedSide
												provider="plex"
												item={plex}
												id={match.plexItemId}
											/>
											<SavedSide
												provider="jellyfin"
												item={jellyfin}
												id={match.jellyfinItemId}
											/>
										</div>
										{(!plex || !jellyfin || plex.kind !== jellyfin.kind) && (
											<Notice tone="warning">
												This match is unavailable and will be skipped during
												sync.
											</Notice>
										)}
										{pendingRemoval?.plexItemId === match.plexItemId ? (
											<div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-canvas px-3 py-2 text-sm">
												<p className="mr-auto text-muted">
													Remove this match? Watched status stays as it is;
													future syncs may match these items by metadata.
												</p>
												<Button
													variant="ghost"
													disabled={remove.isPending}
													onClick={() => setPendingRemoval(null)}
												>
													Cancel
												</Button>
												<Button
													variant="primary"
													disabled={remove.isPending || save.isPending}
													onClick={() => remove.mutate(match)}
												>
													Confirm removal
												</Button>
											</div>
										) : (
											<div>
												<Button
													variant="ghost"
													className="-ml-3.5"
													disabled={remove.isPending || save.isPending}
													onClick={() => {
														setPendingRemoval(match);
														remove.reset();
													}}
												>
													Remove match
												</Button>
											</div>
										)}
									</li>
								);
							})}
						</ul>
					)}
				</section>
			)}
		</>
	);
}

function SavedSide({
	provider,
	item,
	id,
}: {
	provider: Provider;
	item: MediaItem | undefined;
	id: string;
}) {
	return (
		<div className="min-w-0">
			<p className="mb-1.5 text-xs text-faint">
				<ProviderLabel provider={provider} />
			</p>
			{item ? (
				<ItemDetails item={item} />
			) : (
				<p className="text-sm text-muted">
					Unavailable item <span className="font-mono text-xs">({id})</span>
				</p>
			)}
		</div>
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
	provider: Provider;
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
	const [page, setPage] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);
	const providerName = PROVIDER_LABELS[provider];
	const resetPage = () => {
		setPage(0);
		if (listRef.current) listRef.current.scrollTop = 0;
	};
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
		<fieldset
			disabled={disabled}
			className="min-w-0 rounded-lg border border-line bg-surface"
		>
			{/* float + w-full lets the legend lay out like a normal block header. */}
			<legend className="float-left w-full border-b border-line px-5 py-4 text-sm font-semibold">
				<ProviderLabel provider={provider} />
			</legend>
			<div className="clear-both grid gap-3 px-5 py-4">
				<div
					role="radiogroup"
					aria-label={`${providerName} content`}
					className="inline-flex w-fit rounded-md border border-line-strong bg-canvas p-0.5"
				>
					{KIND_OPTIONS.map((option) => (
						<label key={option.value} className="cursor-pointer">
							<input
								type="radio"
								name={`${provider}-kind`}
								value={option.value}
								checked={kind === option.value}
								onChange={() => {
									setKind(option.value);
									resetPage();
									onSelect("");
								}}
								className="peer sr-only"
							/>
							<span className="block rounded px-3 py-1 text-sm pointer-coarse:py-2.5 text-muted transition peer-checked:bg-raised peer-checked:text-ink peer-focus-visible:outline-2 peer-focus-visible:outline-ink">
								{option.label}
							</span>
						</label>
					))}
				</div>
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
								{[...shows]
									.filter(([id]) => id)
									.map(([id, title]) => (
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
				<Field label="Search title or path">
					<input
						type="search"
						className={inputClass}
						value={search}
						onChange={(event) => {
							setSearch(event.target.value);
							resetPage();
							onSelect("");
						}}
					/>
				</Field>
			</div>
			<div
				ref={listRef}
				className="max-h-[28rem] divide-y divide-line overflow-y-auto border-y border-line"
			>
				{!visible.length && (
					<p className="px-5 py-8 text-center text-sm text-faint">
						No items found.
					</p>
				)}
				{pageItems.map((item) => {
					const isReserved = reserved.has(item.id);
					const isSelected = selected === item.id;
					return (
						<label
							key={item.id}
							className={`flex items-start gap-3 px-5 py-3 transition ${isReserved ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-raised/60"} ${isSelected ? "bg-raised shadow-[inset_2px_0_0_var(--color-ink)]" : ""}`}
						>
							<input
								type="radio"
								name={`${provider}-item`}
								aria-label={`${item.title || "Untitled"} (${item.id})`}
								checked={isSelected}
								disabled={isReserved}
								onChange={() => onSelect(item.id)}
								className={`mt-1 accent-ink ${focusRing}`}
							/>
							<div className="min-w-0 flex-1">
								<ItemDetails item={item} />
								{isReserved && (
									<p className="mt-1.5 text-xs text-muted">Manually matched</p>
								)}
							</div>
						</label>
					);
				})}
			</div>
			<div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
				<p aria-live="polite" className="text-xs text-faint tabular-nums">
					{visible.length ? start + 1 : 0}–{start + pageItems.length} of{" "}
					{visible.length}
				</p>
				<div className="flex gap-1">
					<Button
						variant="ghost"
						aria-label={`Previous ${providerName} results page`}
						disabled={currentPage === 0}
						onClick={() => changePage(currentPage - 1)}
					>
						Previous
					</Button>
					<Button
						variant="ghost"
						aria-label={`Next ${providerName} results page`}
						disabled={currentPage === lastPage}
						onClick={() => changePage(currentPage + 1)}
					>
						Next
					</Button>
				</div>
			</div>
		</fieldset>
	);
}

function ItemDetails({ item }: { item: MediaItem }) {
	return (
		<div className="grid min-w-0 gap-1 text-sm">
			<div className="flex items-start justify-between gap-3">
				<p className="font-medium">{item.title || "Untitled"}</p>
				<StatusBadge tone={item.watched ? "success" : "neutral"}>
					{item.watched ? "Watched" : "Unwatched"}
				</StatusBadge>
			</div>
			{item.kind === "episode" && (
				<p className="text-xs text-muted">
					{item.details?.showTitle ?? "Unknown show"} · Season{" "}
					{item.details?.season ?? "unknown"} · Episode{" "}
					{item.details?.episode ?? "unknown"}
				</p>
			)}
			{item.details?.paths?.length ? (
				item.details.paths.map((path) => (
					<p key={path} className="font-mono text-xs break-all text-faint">
						{path}
					</p>
				))
			) : (
				<p className="text-xs text-faint">File path not provided by server</p>
			)}
			<p className="text-xs text-faint">
				{item.ids.length
					? item.ids.map((id) => `${id.provider}: ${id.value}`).join(" · ")
					: "No metadata IDs provided"}
			</p>
		</div>
	);
}
