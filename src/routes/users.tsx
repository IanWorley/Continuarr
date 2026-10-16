import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { Pairings } from "~/components/media/Pairings";
import {
	ErrorMessage,
	responseData,
	useAction,
} from "~/components/media/shared";
import {
	Button,
	cardClass,
	Field,
	inputClass,
	linkClass,
	Page,
	Panel,
	Section,
} from "~/components/ui";
import { getApi } from "~/routes/api.$";

const DIRECTORY_KEY = ["jellyfin-directory"];
const STATE_KEY = ["media-state"];
const REFRESH_MS = 10_000;
const NEVER_LABEL = "Never";
export const Route = createFileRoute("/users")({ component: Users });

/**
 * Eden revives ISO strings into Date objects at runtime even though the
 * response type says string, so normalize through Date before rendering.
 */
function formatActivityDate(value: string | Date | null) {
	return value ? new Date(value).toLocaleString() : NEVER_LABEL;
}

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
		<Page
			title="Users"
			description="Review imported Plex and Jellyfin users, pair the same person, and sync their watched status."
		>
			{(directory.isPending || state.isPending) && (
				<p role="status" className="text-sm text-muted">
					Loading users…
				</p>
			)}
			<ErrorMessage
				message={directory.error?.message ?? state.error?.message ?? ""}
			/>
			{directory.data && state.data && (
				<>
					<Panel
						id="pair-heading"
						title="Pair people"
						description={
							<>
								Connect Plex and Jellyfin on the{" "}
								<Link to="/" className={linkClass}>
									connections page
								</Link>
								, then choose the same person below.
							</>
						}
					>
						{availablePlex.length === 0 || availableJellyfin.length === 0 ? (
							<p className="text-sm text-muted">
								{state.data.pairings.length
									? "No unpaired users are available on both services. Connect or refresh your servers to import more users."
									: "Connect Plex and Jellyfin servers to import users for pairing."}
							</p>
						) : (
							<form
								className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
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
								<Field label="Plex user">
									<select
										className={inputClass}
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
								</Field>
								<Field label="Jellyfin user">
									<select
										className={inputClass}
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
								</Field>
								<Button
									type="submit"
									variant="primary"
									disabled={
										action.busy || state.data.running || !plexId || !jellyfinId
									}
								>
									Create pairing
								</Button>
							</form>
						)}
						<ErrorMessage message={action.error} />
					</Panel>
					<Pairings state={state.data} refresh={refresh} />
					<Section
						id="plex-users-heading"
						title={`Plex users (${state.data.plexProfiles.length})`}
					>
						{state.data.plexProfiles.length === 0 && (
							<p className="text-sm text-muted">
								Connect a Plex server to import its users.
							</p>
						)}
						<div className="grid gap-4 md:grid-cols-2">
							{state.data.plexProfiles.map((user) => (
								<article
									key={user.id}
									className={`${cardClass} space-y-2 p-5 text-sm`}
								>
									<div>
										<h3 className="font-semibold">{user.name}</h3>
										<p className="text-xs text-faint">{user.serverName}</p>
									</div>
									<p className="text-muted">
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
										<p className="text-muted">
											Plex has not granted access to this user's watched status
											on this server.
										</p>
									)}
									{!user.connectionId && (
										<p className="text-muted">
											Previously saved user. Save this server from its owner
											account to enable automatic user imports.
										</p>
									)}
									<p className="text-xs text-faint">User ID {user.userId}</p>
								</article>
							))}
						</div>
					</Section>
					<Section
						id="users-heading"
						title={`Imported Jellyfin users (${directory.data.users.length})`}
					>
						{directory.data.users.length === 0 && (
							<p className="text-sm text-muted">
								No users have been imported yet.
							</p>
						)}
						<div className="grid gap-4 md:grid-cols-2">
							{directory.data.users.map((user) => (
								<article
									key={user.id}
									className={`${cardClass} space-y-2 p-5 text-sm`}
								>
									<div>
										<h3 className="font-semibold">{user.name}</h3>
										<p className="text-xs text-faint">
											{serverName(user.serverId)}
										</p>
									</div>
									<p className="text-muted">
										{user.presence === "present"
											? user.disabled
												? "Disabled"
												: "Available"
											: user.presence === "missing"
												? "Missing from latest import"
												: "Awaiting first import"}{" "}
										· {user.pairingId ? "Paired" : "Unpaired"}
									</p>
									<p className="text-xs text-faint">User ID {user.userId}</p>
									{user.userDetails ? (
										<>
											<dl className="grid grid-cols-[auto_1fr] gap-x-3 text-muted">
												<dt>Administrator</dt>
												<dd className="text-ink">
													{user.administrator ? "Yes" : "No"}
												</dd>
												<dt>Last activity</dt>
												<dd className="text-ink">
													{formatActivityDate(user.lastActivityDate)}
												</dd>
												<dt>Last login</dt>
												<dd className="text-ink">
													{formatActivityDate(user.lastLoginDate)}
												</dd>
											</dl>
											<details>
												<summary className="cursor-pointer text-muted transition hover:text-ink">
													All Jellyfin user details
												</summary>
												<pre className="mt-2 max-h-72 overflow-auto rounded-md border border-line bg-canvas p-3 text-xs text-muted">
													{JSON.stringify(user.userDetails, null, 2)}
												</pre>
											</details>
										</>
									) : (
										<p className="text-muted">
											Refresh this server to load details.
										</p>
									)}
								</article>
							))}
						</div>
					</Section>
				</>
			)}
		</Page>
	);
}
