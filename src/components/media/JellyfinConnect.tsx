import { useEffect, useState } from "react";
import type { MediaService } from "~/backend/media/service";
import {
	ErrorMessage,
	responseData,
	SavedServer,
	SavedServerList,
	useAction,
} from "~/components/media/shared";
import {
	Button,
	Field,
	inputClass,
	Notice,
	Panel,
	ProviderLabel,
} from "~/components/ui";
import { getApi } from "~/routes/api.$";

type Directory = Awaited<ReturnType<MediaService["jellyfinDirectory"]>>;
type Server = Directory["servers"][number];

export function JellyfinConnect({
	servers,
	refresh,
}: {
	servers: Server[];
	refresh: () => Promise<void>;
}) {
	const action = useAction();
	// Earlier versions could save several servers, so more than one means cleanup is needed.
	const saved = servers.length === 1 ? servers[0] : undefined;
	const [url, setUrl] = useState(saved?.url ?? "");
	const [apiKey, setApiKey] = useState("");
	const [message, setMessage] = useState("");
	useEffect(() => {
		setUrl(saved?.url ?? "");
		setApiKey("");
	}, [saved?.url]);
	return (
		<Panel
			id="jellyfin-heading"
			title={<ProviderLabel provider="jellyfin" />}
			description="Create a server API key in Jellyfin Dashboard → API Keys. One connection imports every user and stores the key encrypted."
		>
			{servers.length > 1 ? (
				<Notice tone="warning">
					Continuarr connects one Jellyfin server, and {servers.length} are
					saved. Disconnect the servers you no longer need.
				</Notice>
			) : (
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						void action.perform(async () => {
							const input = saved
								? {
										kind: "replace" as const,
										id: saved.id,
										revision: saved.revision,
										url,
										apiKey,
									}
								: { kind: "new" as const, url, apiKey };
							responseData(await getApi().v1.media.jellyfin.import.post(input));
							setApiKey("");
							setMessage("Jellyfin users imported. Open Users to pair people.");
							await refresh();
						});
					}}
				>
					{saved && (
						<p className="text-sm text-muted">
							Continuarr connects one Jellyfin server. To switch servers,
							disconnect {saved.name} first.
						</p>
					)}
					<Field label="Server URL">
						<input
							className={inputClass}
							type="url"
							value={url}
							required
							autoComplete="url"
							placeholder="http://jellyfin.local:8096"
							onChange={(event) => setUrl(event.target.value)}
						/>
					</Field>
					<Field label="API key">
						<input
							className={inputClass}
							type="password"
							value={apiKey}
							required
							autoComplete="off"
							onChange={(event) => setApiKey(event.target.value)}
						/>
					</Field>
					<Button type="submit" variant="primary" disabled={action.busy}>
						{action.busy
							? "Importing…"
							: saved
								? "Replace key and import users"
								: "Connect and import users"}
					</Button>
					<ErrorMessage message={action.error} />
				</form>
			)}
			{message && <Notice tone="success">{message}</Notice>}
			{servers.length > 0 && (
				<SavedServerList>
					{servers.map((server) => (
						<JellyfinServer
							key={server.id}
							server={server}
							refresh={refresh}
							onDisconnect={() =>
								setMessage(
									`${server.name} disconnected. Mappings and history are preserved. After reconnecting, enable automatic sync again to resume.`,
								)
							}
						/>
					))}
				</SavedServerList>
			)}
		</Panel>
	);
}

function JellyfinServer({
	server,
	refresh,
	onDisconnect,
}: {
	server: Server;
	refresh: () => Promise<void>;
	onDisconnect: () => void;
}) {
	const action = useAction();
	const [confirming, setConfirming] = useState(false);
	return (
		<SavedServer
			server={server}
			status={
				server.lastError
					? "Last refresh failed"
					: server.lastSuccessAt
						? `Last refreshed ${new Date(server.lastSuccessAt).toLocaleString()}`
						: "Waiting for first refresh"
			}
			detail={
				server.lastAttemptAt
					? `Last attempt ${new Date(server.lastAttemptAt).toLocaleString()}`
					: "No attempt yet"
			}
		>
			<ErrorMessage message={server.lastError ?? ""} />
			<div className="flex flex-wrap gap-3">
				<Button
					disabled={action.busy}
					onClick={() =>
						void action.perform(async () => {
							const result = responseData(
								await getApi()
									.v1.media.jellyfin({ id: server.id })
									.refresh.post(),
							);
							if (result.kind === "failed") throw new Error(result.message);
							await refresh();
						})
					}
				>
					Refresh now
				</Button>
				{!confirming && (
					<Button disabled={action.busy} onClick={() => setConfirming(true)}>
						Disconnect
					</Button>
				)}
			</div>
			{confirming && (
				<fieldset
					aria-label={`Disconnect ${server.name}`}
					className="space-y-3 rounded-md border border-line bg-raised p-4 text-sm"
				>
					<p className="font-medium">Disconnect {server.name}?</p>
					<p className="text-muted">
						This removes this server's saved connection and local API key.
						Users, mappings, manual matches, and sync history stay. Automatic
						sync for its pairings pauses. After reconnecting, enable automatic
						sync again to resume.
					</p>
					<div className="flex flex-wrap gap-3">
						<Button
							variant="danger"
							disabled={action.busy}
							onClick={() =>
								void action.perform(async () => {
									responseData(
										await getApi()
											.v1.media.jellyfin({ id: server.id })
											.delete(),
									);
									setConfirming(false);
									onDisconnect();
									await refresh();
								})
							}
						>
							{action.busy ? "Disconnecting…" : "Confirm disconnect"}
						</Button>
						<Button disabled={action.busy} onClick={() => setConfirming(false)}>
							Cancel
						</Button>
					</div>
				</fieldset>
			)}
			<ErrorMessage message={action.error} />
		</SavedServer>
	);
}
