import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { MediaService } from "~/backend/media/service";
import {
	buttonClass,
	ErrorMessage,
	fieldClass,
	type MediaState,
	responseData,
	useAction,
} from "~/components/media/shared";
import { getApi } from "~/routes/api.$";

type JellyfinSource = Parameters<MediaService["jellyfinUsers"]>[0]["source"];

export function JellyfinConnect({
	profiles,
	refresh,
}: {
	profiles: MediaState["jellyfinProfiles"];
	refresh: () => Promise<void>;
}) {
	const action = useAction();
	const [url, setUrl] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [userId, setUserId] = useState("");
	const [newUsers, setUsers] = useState<
		Awaited<ReturnType<MediaService["jellyfinUsers"]>>
	>([]);
	const [savedProfileId, setSavedProfileId] = useState(profiles[0]?.id ?? "");
	const activeSavedProfileId = profiles.some(
		(profile) => profile.id === savedProfileId,
	)
		? savedProfileId
		: "";
	const activeSavedProfile = profiles.find(
		(profile) => profile.id === activeSavedProfileId,
	);
	const savedServerMap = new Map<
		string,
		MediaState["jellyfinProfiles"][number]
	>();
	for (const profile of profiles) {
		if (
			!savedServerMap.has(profile.serverId) ||
			profile.id === activeSavedProfileId
		)
			savedServerMap.set(profile.serverId, profile);
	}
	const savedServers = [...savedServerMap.values()];
	const savedUsers = useQuery({
		queryKey: ["jellyfin-users", activeSavedProfileId],
		enabled: !!activeSavedProfileId,
		queryFn: async () =>
			responseData(
				await getApi().v1.media.jellyfin.users.post({
					source: { kind: "saved", profileId: activeSavedProfileId },
				}),
			),
	});
	const users = activeSavedProfileId ? (savedUsers.data ?? []) : newUsers;
	const source: JellyfinSource = activeSavedProfileId
		? { kind: "saved", profileId: activeSavedProfileId }
		: { kind: "new", url, apiKey };
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
				{activeSavedProfileId
					? "Choose a person from this server. Continuarr reuses its saved API key."
					: "Create an API key in Jellyfin’s Dashboard → API Keys, then choose the person to sync. The key grants server-wide access and is stored encrypted."}
			</p>
			<form
				className="space-y-4"
				onSubmit={(event) => {
					event.preventDefault();
					void action.perform(async () => {
						setMessage("");
						if (users.length === 0) {
							const found = responseData(
								await getApi().v1.media.jellyfin.users.post({ source }),
							);
							setUsers(found);
							if (found.length === 0) setMessage("No Jellyfin users found.");
							return;
						}
						const connected = responseData(
							await getApi().v1.media.jellyfin.connect.post({
								source,
								userId,
							}),
						);
						setMessage("Jellyfin profile connected. Create a pairing below.");
						await refresh();
						if (!activeSavedProfileId) setSavedProfileId(connected.id);
						setApiKey("");
						setUsers([]);
						setUserId("");
					});
				}}
			>
				{savedServers.length > 0 && (
					<label
						className="block text-sm text-slate-300"
						htmlFor="jellyfin-source"
					>
						Jellyfin server
						<select
							id="jellyfin-source"
							className={fieldClass}
							value={activeSavedProfileId}
							disabled={action.busy}
							onChange={(event) => {
								setSavedProfileId(event.target.value);
								setUserId("");
								setUsers([]);
								setMessage("");
							}}
						>
							<option value="">Add a server or replace an API key</option>
							{savedServers.map((profile) => (
								<option key={profile.serverId} value={profile.id}>
									{profile.url}
								</option>
							))}
						</select>
					</label>
				)}
				{!activeSavedProfileId && (
					<>
						<label
							className="block text-sm text-slate-300"
							htmlFor="jellyfin-url"
						>
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
								onChange={(event) => {
									setUrl(event.target.value);
									setUsers([]);
									setUserId("");
								}}
							/>
						</label>
						<label
							className="block text-sm text-slate-300"
							htmlFor="jellyfin-api-key"
						>
							API key
							<input
								id="jellyfin-api-key"
								className={fieldClass}
								type="password"
								autoComplete="off"
								required
								value={apiKey}
								disabled={action.busy}
								onChange={(event) => {
									setApiKey(event.target.value);
									setUsers([]);
									setUserId("");
								}}
							/>
						</label>
					</>
				)}
				{activeSavedProfileId && (
					<>
						{savedUsers.isPending && (
							<p role="status" className="text-sm text-slate-400">
								Loading Jellyfin users…
							</p>
						)}
						{savedUsers.error && (
							<div className="space-y-3">
								<ErrorMessage message={savedUsers.error.message} />
								<p className="text-sm leading-6 text-slate-400">
									If this connection was created with a username and password,
									its saved credential may not allow user discovery. Create a
									server API key in Jellyfin’s Dashboard → API Keys, then
									replace it here.
								</p>
								<button
									type="button"
									className="text-sm text-cyan-300 underline underline-offset-4 hover:text-cyan-200"
									onClick={() => {
										setUrl(activeSavedProfile?.url ?? "");
										setApiKey("");
										setUserId("");
										setUsers([]);
										setMessage("");
										action.clearError();
										setSavedProfileId("");
									}}
								>
									Replace API key
								</button>
							</div>
						)}
						{savedUsers.data?.length === 0 && (
							<p role="status" className="text-sm text-slate-400">
								No Jellyfin users found.
							</p>
						)}
						<button
							type="button"
							className="text-sm text-slate-400 underline underline-offset-4"
							disabled={savedUsers.isFetching}
							onClick={() => void savedUsers.refetch()}
						>
							Refresh Jellyfin users
						</button>
					</>
				)}
				{users.length > 0 && (
					<label
						className="block text-sm text-slate-300"
						htmlFor="jellyfin-user"
					>
						User to sync
						<select
							id="jellyfin-user"
							className={fieldClass}
							required
							value={userId}
							disabled={action.busy}
							onChange={(event) => setUserId(event.target.value)}
						>
							<option value="">Choose a user</option>
							{users.map((user) => (
								<option key={user.id} value={user.id}>
									{user.name}
								</option>
							))}
						</select>
					</label>
				)}
				<button
					type="submit"
					className={buttonClass}
					disabled={
						action.busy ||
						(!!activeSavedProfileId &&
							(!userId || savedUsers.isPending || !!savedUsers.error))
					}
				>
					{action.busy
						? "Connecting…"
						: users.length > 0
							? "Connect Jellyfin profile"
							: "Find Jellyfin users"}
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
