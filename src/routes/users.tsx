import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type ReactNode, useCallback, useState } from "react";
import type { MediaService } from "~/backend/media/service";
import { PairingRow } from "~/components/media/Pairings";
import {
	ErrorMessage,
	jellyfinDirectoryQuery,
	type MediaState,
	mediaStateQuery,
	responseData,
	useAction,
} from "~/components/media/shared";
import {
	Button,
	EmptyState,
	Field,
	inputClass,
	Notice,
	Page,
	Panel,
	ProviderLabel,
	StatusBadge,
	type Tone,
} from "~/components/ui";
import { getApi } from "~/routes/api.$";

type PlexUser = MediaState["plexProfiles"][number];
type JellyfinUser = Awaited<
	ReturnType<MediaService["jellyfinDirectory"]>
>["users"][number];

export const Route = createFileRoute("/users")({ component: Users });

function Users() {
	const client = useQueryClient();
	const directory = useQuery(jellyfinDirectoryQuery);
	const state = useQuery(mediaStateQuery);
	const refresh = useCallback(async () => {
		await Promise.all([
			client.invalidateQueries({ queryKey: jellyfinDirectoryQuery.queryKey }),
			client.invalidateQueries({ queryKey: mediaStateQuery.queryKey }),
		]);
	}, [client]);
	const serverName = (id: string | null) =>
		directory.data?.servers.find((server) => server.id === id)?.name ??
		"Jellyfin server";
	return (
		<Page
			title="Users"
			description="Pair the same person on Plex and Jellyfin. Anything watched on either server is marked watched on both; nothing is ever marked unwatched."
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
						id="pairings-heading"
						title={`Pairings (${state.data.pairings.length})`}
						description="Preview reads both libraries without writing. Manual matches take priority; other items need a shared IMDb, TMDb, or TVDb ID."
					>
						{state.data.running && (
							<div className="border-b border-line px-5 py-3">
								<Notice tone="neutral">
									A sync is running. Results will update automatically.
								</Notice>
							</div>
						)}
						{state.data.pairings.length > 0 && (
							<ul aria-label="Pairings" className="divide-y divide-line">
								{state.data.pairings.map((pair) => (
									<PairingRow
										key={pair.id}
										pair={pair}
										state={state.data}
										refresh={refresh}
									/>
								))}
							</ul>
						)}
						<div
							className={
								state.data.pairings.length ? "border-t border-line" : ""
							}
						>
							<CreatePairing
								state={state.data}
								jellyfinUsers={directory.data.users}
								serverName={serverName}
								refresh={refresh}
							/>
						</div>
					</Panel>
					<Panel
						id="plex-users-heading"
						title={
							<ProviderLabel provider="plex">
								Plex users ({state.data.plexProfiles.length})
							</ProviderLabel>
						}
					>
						{state.data.plexProfiles.length === 0 ? (
							<EmptyState>
								Connect a Plex server to import its users.
							</EmptyState>
						) : (
							<ul className="divide-y divide-line">
								{state.data.plexProfiles.map((user) => (
									<PlexUserRow
										key={user.id}
										user={user}
										paired={state.data.pairings.some(
											(pair) => pair.plexProfileId === user.id,
										)}
									/>
								))}
							</ul>
						)}
					</Panel>
					<Panel
						id="users-heading"
						title={
							<ProviderLabel provider="jellyfin">
								Jellyfin users ({directory.data.users.length})
							</ProviderLabel>
						}
					>
						{directory.data.users.length === 0 ? (
							<EmptyState>No users have been imported yet.</EmptyState>
						) : (
							<ul className="divide-y divide-line">
								{directory.data.users.map((user) => (
									<JellyfinUserRow
										key={user.id}
										user={user}
										serverName={serverName(user.serverId)}
									/>
								))}
							</ul>
						)}
					</Panel>
				</>
			)}
		</Page>
	);
}

function CreatePairing({
	state,
	jellyfinUsers,
	serverName,
	refresh,
}: {
	state: MediaState;
	jellyfinUsers: JellyfinUser[];
	serverName: (id: string | null) => string;
	refresh: () => Promise<void>;
}) {
	const action = useAction();
	const [plexId, setPlexId] = useState("");
	const [jellyfinId, setJellyfinId] = useState("");
	const availablePlex = state.plexProfiles.filter(
		(profile) =>
			profile.presence !== "missing" &&
			profile.accessStatus === "available" &&
			!state.pairings.some((pair) => pair.plexProfileId === profile.id),
	);
	const availableJellyfin = jellyfinUsers.filter(
		(user) => user.presence === "present" && !user.disabled && !user.pairingId,
	);
	if (availablePlex.length === 0 || availableJellyfin.length === 0)
		return (
			<p className="px-5 py-4 text-sm text-muted">
				{state.pairings.length
					? "Everyone available on both services is paired. Refresh your servers to import more users."
					: "Import users from both services to start pairing."}{" "}
				<Link to="/" className="text-ink underline underline-offset-4">
					Connections & sync
				</Link>
			</p>
		);
	return (
		<form
			className="grid gap-4 px-5 py-4 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end"
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
			<span aria-hidden="true" className="hidden pb-2 text-faint sm:block">
				↔
			</span>
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
				variant="primary"
				type="submit"
				disabled={action.busy || state.running || !plexId || !jellyfinId}
			>
				Create pairing
			</Button>
			<div className="sm:col-span-full">
				<ErrorMessage message={action.error} />
			</div>
		</form>
	);
}

function plexUserStatus(user: PlexUser): { tone: Tone; label: string } {
	if (user.presence === "missing")
		return { tone: "danger", label: "Missing from latest import" };
	if (user.accessStatus === "unavailable")
		return { tone: "warning", label: "Watched status unavailable" };
	return { tone: "success", label: "Available" };
}

function jellyfinUserStatus(user: JellyfinUser): { tone: Tone; label: string } {
	if (user.presence === "missing")
		return { tone: "danger", label: "Missing from latest import" };
	if (user.presence !== "present")
		return { tone: "neutral", label: "Awaiting first import" };
	if (user.disabled) return { tone: "warning", label: "Disabled" };
	return { tone: "success", label: "Available" };
}

function DirectoryRow({
	name,
	server,
	userId,
	status,
	paired,
	children,
}: {
	name: string;
	server: string;
	userId: string;
	status: { tone: Tone; label: string };
	paired: boolean;
	children?: ReactNode;
}) {
	return (
		<li className="px-5 py-3">
			<div className="grid gap-1 sm:grid-cols-[1fr_12rem_6rem] sm:items-center sm:gap-4">
				<div className="min-w-0">
					<h3 className="text-sm font-medium">{name}</h3>
					<p className="mt-0.5 text-xs text-faint">
						{server} · <span className="font-mono">User ID {userId}</span>
					</p>
				</div>
				<StatusBadge tone={status.tone}>{status.label}</StatusBadge>
				<span className={`text-xs ${paired ? "text-ink" : "text-faint"}`}>
					{paired ? "Paired" : "Unpaired"}
				</span>
			</div>
			{children}
		</li>
	);
}

function PlexUserRow({ user, paired }: { user: PlexUser; paired: boolean }) {
	return (
		<DirectoryRow
			name={user.name}
			server={user.serverName}
			userId={user.userId}
			status={plexUserStatus(user)}
			paired={paired}
		>
			{user.accessStatus === "unavailable" && (
				<p className="mt-2 text-xs text-muted">
					Plex has not granted access to this user's watched status on this
					server.
				</p>
			)}
			{!user.connectionId && (
				<p className="mt-2 text-xs text-muted">
					Previously saved user. Save this server from its owner account to
					enable automatic user imports.
				</p>
			)}
		</DirectoryRow>
	);
}

function JellyfinUserRow({
	user,
	serverName,
}: {
	user: JellyfinUser;
	serverName: string;
}) {
	return (
		<DirectoryRow
			name={user.name}
			server={serverName}
			userId={user.userId}
			status={jellyfinUserStatus(user)}
			paired={Boolean(user.pairingId)}
		>
			{user.userDetails ? (
				<details className="group mt-2">
					<summary className="cursor-pointer py-2 text-xs text-muted hover:text-ink pointer-coarse:py-3.5">
						Details
					</summary>
					<dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
						<dt className="text-faint">Administrator</dt>
						<dd>{user.administrator ? "Yes" : "No"}</dd>
						<dt className="text-faint">Last activity</dt>
						<dd>{user.lastActivityDate ?? "Never"}</dd>
						<dt className="text-faint">Last login</dt>
						<dd>{user.lastLoginDate ?? "Never"}</dd>
					</dl>
					<pre className="mt-3 max-h-72 overflow-auto rounded-md border border-line bg-canvas p-3 font-mono text-xs text-muted">
						{JSON.stringify(user.userDetails, null, 2)}
					</pre>
				</details>
			) : (
				<p className="mt-2 text-xs text-muted">
					Refresh this server to load details.
				</p>
			)}
		</DirectoryRow>
	);
}
