import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { Pairings } from "~/components/media/Pairings";
import {
	buttonClass,
	ErrorMessage,
	fieldClass,
	responseData,
	useAction,
} from "~/components/media/shared";
import { getApi } from "~/routes/api.$";

const DIRECTORY_KEY = ["jellyfin-directory"];
const STATE_KEY = ["media-state"];
const REFRESH_MS = 10_000;
export const Route = createFileRoute("/users")({ component: Users });

function Users() {
	const client = useQueryClient();
	const directory = useQuery({
		queryKey: DIRECTORY_KEY,
		queryFn: async () =>
			responseData(await getApi().v1.media.jellyfin.directory.get()),
		refetchInterval: REFRESH_MS,
	});
	const state = useQuery({
		queryKey: STATE_KEY,
		queryFn: async () => responseData(await getApi().v1.media.state.get()),
		refetchInterval: REFRESH_MS,
	});
	const refresh = useCallback(async () => {
		await Promise.all([
			client.invalidateQueries({ queryKey: DIRECTORY_KEY }),
			client.invalidateQueries({ queryKey: STATE_KEY }),
		]);
	}, [client]);
	const action = useAction();
	const [plexId, setPlexId] = useState("");
	const [jellyfinId, setJellyfinId] = useState("");
	const availablePlex =
		state.data?.plexProfiles.filter(
			(profile) =>
				profile.presence !== "missing" &&
				profile.accessStatus === "available" &&
				!state.data.pairings.some((pair) => pair.plexProfileId === profile.id),
		) ?? [];
	const availableJellyfin =
		directory.data?.users.filter(
			(user) =>
				user.presence === "present" && !user.disabled && !user.pairingId,
		) ?? [];
	const serverName = (id: string | null) =>
		directory.data?.servers.find((server) => server.id === id)?.name ??
		"Jellyfin server";
	return (
		<main
			id="main-content"
			tabIndex={-1}
			className="mx-auto min-h-screen max-w-6xl px-5 py-8 sm:px-8 sm:py-12"
		>
			<header className="mb-8 border-b border-slate-800 pb-6">
				<h1 className="text-3xl font-semibold">Users</h1>
				<p className="mt-2 text-sm text-slate-400">
					Review imported Plex and Jellyfin users, pair the same person, and
					sync their watched status.
				</p>
			</header>
			{(directory.isPending || state.isPending) && (
				<p role="status">Loading users…</p>
			)}
			<ErrorMessage
				message={directory.error?.message ?? state.error?.message ?? ""}
			/>
			{directory.data && state.data && (
				<div className="space-y-8">
					<section
						className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6"
						aria-labelledby="pair-heading"
					>
						<h2 id="pair-heading" className="text-xl font-semibold">
							Pair people
						</h2>
						<p className="mt-2 text-sm text-slate-400">
							Connect Plex and Jellyfin on the{" "}
							<Link to="/" className="text-cyan-300 underline">
								connections page
							</Link>
							, then choose the same person below.
						</p>
						{availablePlex.length === 0 || availableJellyfin.length === 0 ? (
							<p className="mt-4 text-sm text-slate-400">
								{state.data.pairings.length
									? "No unpaired users are available on both services. Connect or refresh your servers to import more users."
									: "Connect Plex and Jellyfin servers to import users for pairing."}
							</p>
						) : (
							<form
								className="mt-5 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
								onSubmit={(event) => {
									event.preventDefault();
									void action.perform(async () => {
										responseData(
											await getApi().v1.media.pairings.post({
												plexProfileId: plexId,
												jellyfinProfileId: jellyfinId,
											}),
										);
										setPlexId("");
										setJellyfinId("");
										await refresh();
									});
								}}
							>
								<label className="text-sm text-slate-300">
									Plex user
									<select
										className={fieldClass}
										value={plexId}
										required
										onChange={(event) => setPlexId(event.target.value)}
									>
										<option value="">Choose a person</option>
										{availablePlex.map((profile) => (
											<option key={profile.id} value={profile.id}>
												{profile.name} · {profile.serverName}
											</option>
										))}
									</select>
								</label>
								<label className="text-sm text-slate-300">
									Jellyfin user
									<select
										className={fieldClass}
										value={jellyfinId}
										required
										onChange={(event) => setJellyfinId(event.target.value)}
									>
										<option value="">Choose the same person</option>
										{availableJellyfin.map((user) => (
											<option key={user.id} value={user.id}>
												{user.name} · {serverName(user.serverId)}
											</option>
										))}
									</select>
								</label>
								<button
									className={buttonClass}
									type="submit"
									disabled={
										action.busy || state.data.running || !plexId || !jellyfinId
									}
								>
									Create pairing
								</button>
							</form>
						)}
						<ErrorMessage message={action.error} />
					</section>
					<Pairings state={state.data} refresh={refresh} />
					<section aria-labelledby="plex-users-heading">
						<h2 id="plex-users-heading" className="mb-4 text-xl font-semibold">
							Plex users ({state.data.plexProfiles.length})
						</h2>
						{state.data.plexProfiles.length === 0 && (
							<p className="text-sm text-slate-400">
								Connect a Plex server to import its users.
							</p>
						)}
						<div className="grid gap-4 md:grid-cols-2">
							{state.data.plexProfiles.map((user) => (
								<article
									key={user.id}
									className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5"
								>
									<h3 className="font-semibold">{user.name}</h3>
									<p className="mt-1 text-xs text-slate-500">
										{user.serverName}
									</p>
									<p className="mt-1 text-sm text-slate-400">
										{user.presence === "missing"
											? "Missing from latest import"
											: user.accessStatus === "unavailable"
												? "Watched status unavailable"
												: "Available"}{" "}
										·{" "}
										{state.data.pairings.some(
											(pair) => pair.plexProfileId === user.id,
										)
											? "Paired"
											: "Unpaired"}
									</p>
									{user.accessStatus === "unavailable" && (
										<p className="mt-2 text-sm text-slate-400">
											Plex has not granted access to this user's watched status
											on this server.
										</p>
									)}
									{!user.connectionId && (
										<p className="mt-2 text-sm text-slate-400">
											Previously saved user. Save this server from its owner
											account to enable automatic user imports.
										</p>
									)}
									<p className="mt-2 text-xs text-slate-500">
										User ID {user.userId}
									</p>
								</article>
							))}
						</div>
					</section>
					<section aria-labelledby="users-heading">
						<h2 id="users-heading" className="mb-4 text-xl font-semibold">
							Imported Jellyfin users ({directory.data.users.length})
						</h2>
						{directory.data.users.length === 0 && (
							<p className="text-sm text-slate-400">
								No users have been imported yet.
							</p>
						)}
						<div className="grid gap-4 md:grid-cols-2">
							{directory.data.users.map((user) => (
								<article
									key={user.id}
									className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5"
								>
									<h3 className="font-semibold">{user.name}</h3>
									<p className="mt-1 text-xs text-slate-500">
										{serverName(user.serverId)}
									</p>
									<p className="mt-1 text-sm text-slate-400">
										{user.presence === "present"
											? user.disabled
												? "Disabled"
												: "Available"
											: user.presence === "missing"
												? "Missing from latest import"
												: "Awaiting first import"}{" "}
										· {user.pairingId ? "Paired" : "Unpaired"}
									</p>
									<p className="mt-2 text-xs text-slate-500">
										User ID {user.userId}
									</p>
									{user.userDetails ? (
										<>
											<p className="mt-2 text-sm text-slate-300">
												Administrator: {user.administrator ? "Yes" : "No"}
											</p>
											<p className="text-sm text-slate-300">
												Last activity: {user.lastActivityDate ?? "Never"}
											</p>
											<p className="text-sm text-slate-300">
												Last login: {user.lastLoginDate ?? "Never"}
											</p>
											<details className="mt-3">
												<summary className="cursor-pointer text-sm text-cyan-300">
													All Jellyfin user details
												</summary>
												<pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-300">
													{JSON.stringify(user.userDetails, null, 2)}
												</pre>
											</details>
										</>
									) : (
										<p className="mt-2 text-sm text-slate-400">
											Refresh this server to load details.
										</p>
									)}
								</article>
							))}
						</div>
					</section>
				</div>
			)}
		</main>
	);
}
