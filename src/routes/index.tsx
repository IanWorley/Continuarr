import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import type { MediaService } from "~/backend/media/service";
import { getApi } from "~/routes/api.$";

const HTTP_UNAUTHORIZED = 401;
const STATE_REFRESH_MS = 10_000;
const PREVIEW_VISIBLE_LIMIT = 100;
const RECENT_RUN_LIMIT = 5;
const STATE_QUERY_KEY = ["media-state"];
const fieldClass =
	"mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 disabled:opacity-50";
const buttonClass =
	"rounded-lg bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40";
const secondaryClass =
	"rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40";
const errorSchema = z.object({ value: z.object({ error: z.string() }) });
type MediaState = Awaited<ReturnType<MediaService["state"]>>;
type PlexSelection = Awaited<ReturnType<MediaService["selectProfile"]>>;
type Preview = Awaited<ReturnType<MediaService["preview"]>>;
type Authorization =
	| { kind: "idle" }
	| {
			kind: "waiting";
			attempt: Awaited<ReturnType<MediaService["startLogin"]>>;
	  }
	| { kind: "linked" }
	| { kind: "failed"; message: string };

function responseData<T>(response: {
	data: T | null;
	error: unknown;
	status: number;
}): T {
	if (response.status === HTTP_UNAUTHORIZED && typeof window !== "undefined") {
		window.location.assign("/sign-in");
	}
	if (response.error || response.data === null) {
		const parsed = errorSchema.safeParse(response.error);
		throw new Error(
			parsed.success
				? parsed.data.value.error
				: "Unable to complete this request. Please try again.",
		);
	}
	return response.data;
}

const stateQuery = queryOptions({
	queryKey: STATE_QUERY_KEY,
	queryFn: async () => responseData(await getApi().v1.media.state.get()),
	refetchInterval: STATE_REFRESH_MS,
});

function useAction() {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	async function perform(action: () => Promise<void>) {
		setBusy(true);
		setError("");
		try {
			await action();
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: "Unable to complete this request. Please try again.",
			);
		} finally {
			setBusy(false);
		}
	}
	return { busy, error, perform };
}

function ErrorMessage({ message }: { message: string }) {
	return message ? (
		<p
			role="alert"
			className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200"
		>
			{message}
		</p>
	) : null;
}

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	const state = useQuery(stateQuery);
	const queryClient = useQueryClient();
	const signOut = useAction();
	const refresh = useCallback(async () => {
		await queryClient.invalidateQueries({ queryKey: STATE_QUERY_KEY });
	}, [queryClient]);
	return (
		<main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
			<header className="mb-10 flex items-start justify-between gap-6 border-b border-slate-800 pb-7">
				<div>
					<p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
						Your libraries, together
					</p>
					<h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
						Continuarr
					</h1>
					<p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
						Keep watched movies and episodes in sync between Plex and Jellyfin,
						for each person.
					</p>
				</div>
				<button
					type="button"
					className={secondaryClass}
					disabled={signOut.busy}
					onClick={() =>
						void signOut.perform(async () => {
							const result = await getApi().v1.admin["sign-out"].post();
							if (result.error && result.status !== HTTP_UNAUTHORIZED)
								throw new Error("Unable to sign out. Please try again.");
							window.location.assign("/sign-in");
						})
					}
				>
					Sign out
				</button>
			</header>
			<ErrorMessage message={signOut.error} />
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

function PlexConnect({
	account,
	profiles,
	refresh,
}: {
	account: MediaState["accounts"][number] | undefined;
	profiles: MediaState["plexProfiles"];
	refresh: () => Promise<void>;
}) {
	const action = useAction();
	const [authorization, setAuthorization] = useState<Authorization>({
		kind: "idle",
	});
	const [selection, setSelection] = useState<PlexSelection | null>(null);
	const [serverId, setServerId] = useState("");
	const [serverUrl, setServerUrl] = useState("");
	const [message, setMessage] = useState("");
	const selectedServer = selection?.servers.find(
		(server) => server.id === serverId,
	);

	useEffect(() => {
		if (authorization.kind !== "waiting") return;
		const { attempt } = authorization;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout>;
		async function poll() {
			if (Date.now() >= attempt.expiresAt) {
				setAuthorization({
					kind: "failed",
					message:
						"Plex sign-in expired. Start again to get a new sign-in link.",
				});
				return;
			}
			try {
				const result = responseData(
					await getApi().v1.media.plex.poll.post({ id: attempt.id }),
				);
				if (cancelled) return;
				if (result.status === "linked") {
					setAuthorization({ kind: "linked" });
					setSelection(null);
					await refresh();
				} else if (result.status === "expired") {
					setAuthorization({
						kind: "failed",
						message:
							"Plex sign-in expired. Start again to get a new sign-in link.",
					});
				} else {
					timer = setTimeout(() => void poll(), attempt.pollIntervalMs);
				}
			} catch (failure) {
				if (!cancelled)
					setAuthorization({
						kind: "failed",
						message:
							failure instanceof Error
								? failure.message
								: "Unable to check Plex sign-in. Start again.",
					});
			}
		}
		timer = setTimeout(() => void poll(), attempt.pollIntervalMs);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [authorization, refresh]);

	return (
		<section
			className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6"
			aria-labelledby="plex-heading"
		>
			<div className="mb-5 flex items-center gap-3">
				<span className="size-2 rounded-full bg-amber-400" />
				<h3 id="plex-heading" className="text-lg font-semibold">
					Plex
				</h3>
			</div>
			<div className="space-y-4">
				<p className="text-sm leading-6 text-slate-400">
					Sign in to Plex, then find a server for your account.
				</p>
				<button
					type="button"
					className={secondaryClass}
					disabled={action.busy || authorization.kind === "waiting"}
					onClick={() =>
						void action.perform(async () => {
							setMessage("");
							const attempt = responseData(
								await getApi().v1.media.plex.start.post(),
							);
							setAuthorization({ kind: "waiting", attempt });
						})
					}
				>
					{action.busy ? "Connecting…" : "Sign in to Plex"}
				</button>
				{authorization.kind === "waiting" && (
					<div className="space-y-3 rounded-xl border border-amber-400/25 bg-amber-400/5 p-4">
						<a
							href={authorization.attempt.authorizationUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex rounded-lg bg-amber-300 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-200"
						>
							Continue to Plex ↗
						</a>
						<p role="status" className="text-sm text-slate-300">
							Finish signing in in the new tab. This page will update
							automatically.
						</p>
						<button
							type="button"
							className="text-sm text-slate-400 underline underline-offset-4"
							onClick={() => setAuthorization({ kind: "idle" })}
						>
							Cancel sign-in
						</button>
					</div>
				)}
				{authorization.kind === "linked" && (
					<p role="status" className="text-sm text-emerald-300">
						Account linked. Find a server below.
					</p>
				)}
				{authorization.kind === "failed" && (
					<ErrorMessage message={authorization.message} />
				)}
				{account && (
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							void action.perform(async () => {
								setMessage("");
								const result = responseData(
									await getApi().v1.media.plex.select.post({
										accountId: account.id,
										userId: account.userId,
									}),
								);
								setSelection(result);
								setServerId("");
								setServerUrl("");
							});
						}}
					>
						<p className="text-sm text-slate-400">
							Using {account.name} as the Plex profile.
						</p>
						<button
							type="submit"
							className={secondaryClass}
							disabled={action.busy}
						>
							{action.busy ? "Checking profile…" : "Find Plex servers"}
						</button>
					</form>
				)}
				{selection && (
					<form
						className="space-y-4 border-t border-slate-800 pt-4"
						onSubmit={(event) => {
							event.preventDefault();
							void action.perform(async () => {
								responseData(
									await getApi().v1.media.plex.connect.post({
										selectionId: selection.id,
										serverId,
										url: serverUrl,
									}),
								);
								setSelection(null);
								setMessage(
									"Plex profile connected. Pair it with a Jellyfin profile below.",
								);
								await refresh();
							});
						}}
					>
						{selection.servers.length === 0 ? (
							<p className="text-sm text-amber-200">
								This profile has no accessible Plex servers. Check its library
								access in Plex, then select the profile again.
							</p>
						) : (
							<>
								<label
									className="block text-sm text-slate-300"
									htmlFor="plex-server"
								>
									Server
									<select
										id="plex-server"
										className={fieldClass}
										required
										value={serverId}
										disabled={action.busy}
										onChange={(event) => {
											setServerId(event.target.value);
											setServerUrl("");
										}}
									>
										<option value="">Choose a server</option>
										{selection.servers.map((server) => (
											<option key={server.id} value={server.id}>
												{server.name}
											</option>
										))}
									</select>
								</label>
								{selectedServer && (
									<label
										className="block text-sm text-slate-300"
										htmlFor="plex-url"
									>
										Server address
										<select
											id="plex-url"
											className={fieldClass}
											required
											value={serverUrl}
											disabled={action.busy}
											onChange={(event) => setServerUrl(event.target.value)}
										>
											<option value="">
												Choose an address reachable by Continuarr
											</option>
											{selectedServer.connections.map((url) => (
												<option key={url} value={url}>
													{url}
												</option>
											))}
										</select>
									</label>
								)}
								<button
									type="submit"
									className={buttonClass}
									disabled={action.busy || !serverUrl}
								>
									{action.busy ? "Connecting…" : "Save Plex profile"}
								</button>
							</>
						)}
					</form>
				)}
				<ErrorMessage message={action.error} />
				{message && (
					<p role="status" className="text-sm text-emerald-300">
						{message}
					</p>
				)}
				{profiles.length > 0 && (
					<div className="border-t border-slate-800 pt-4">
						<h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
							Saved profiles
						</h4>
						<ul className="space-y-2">
							{profiles.map((profile) => (
								<li key={profile.id} className="text-sm">
									<span className="text-slate-200">{profile.name}</span>
									<span className="ml-2 text-slate-500">
										on {profile.serverName}
									</span>
								</li>
							))}
						</ul>
					</div>
				)}
			</div>
		</section>
	);
}

function JellyfinConnect({
	profiles,
	refresh,
}: {
	profiles: MediaState["jellyfinProfiles"];
	refresh: () => Promise<void>;
}) {
	const action = useAction();
	const [url, setUrl] = useState("");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [message, setMessage] = useState("");
	return (
		<section
			className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6"
			aria-labelledby="jellyfin-heading"
		>
			<div className="mb-5 flex items-center gap-3">
				<span className="size-2 rounded-full bg-violet-400" />
				<h3 id="jellyfin-heading" className="text-lg font-semibold">
					Jellyfin
				</h3>
			</div>
			<p className="mb-4 text-sm leading-6 text-slate-400">
				Sign in as the person you want to sync. Your password is used once to
				connect and is not saved.
			</p>
			<form
				className="space-y-4"
				onSubmit={(event) => {
					event.preventDefault();
					void action.perform(async () => {
						setMessage("");
						try {
							responseData(
								await getApi().v1.media.jellyfin.connect.post({
									url,
									username,
									password,
								}),
							);
							setMessage("Jellyfin profile connected. Create a pairing below.");
							await refresh();
						} finally {
							setPassword("");
						}
					});
				}}
			>
				<label className="block text-sm text-slate-300" htmlFor="jellyfin-url">
					Server URL
					<input
						id="jellyfin-url"
						className={fieldClass}
						type="url"
						placeholder="http://jellyfin.local:8096"
						autoComplete="url"
						required
						value={url}
						disabled={action.busy}
						onChange={(event) => setUrl(event.target.value)}
					/>
				</label>
				<label
					className="block text-sm text-slate-300"
					htmlFor="jellyfin-username"
				>
					Username
					<input
						id="jellyfin-username"
						className={fieldClass}
						autoComplete="username"
						required
						value={username}
						disabled={action.busy}
						onChange={(event) => setUsername(event.target.value)}
					/>
				</label>
				<label
					className="block text-sm text-slate-300"
					htmlFor="jellyfin-password"
				>
					Password
					<input
						id="jellyfin-password"
						className={fieldClass}
						type="password"
						autoComplete="current-password"
						value={password}
						disabled={action.busy}
						onChange={(event) => setPassword(event.target.value)}
					/>
				</label>
				<button type="submit" className={buttonClass} disabled={action.busy}>
					{action.busy ? "Connecting…" : "Connect Jellyfin profile"}
				</button>
				<ErrorMessage message={action.error} />
				{message && (
					<p role="status" className="text-sm text-emerald-300">
						{message}
					</p>
				)}
			</form>
			{profiles.length > 0 && (
				<div className="mt-4 border-t border-slate-800 pt-4">
					<h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
						Saved profiles
					</h4>
					<ul className="space-y-2">
						{profiles.map((profile) => (
							<li key={profile.id} className="break-words text-sm">
								<span className="text-slate-200">{profile.name}</span>
								<span className="ml-2 text-slate-500">on {profile.url}</span>
							</li>
						))}
					</ul>
				</div>
			)}
		</section>
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
				again before updating watched status. Items without a unique matching
				movie or episode ID are skipped.
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
