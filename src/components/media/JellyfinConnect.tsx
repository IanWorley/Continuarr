import { useState } from "react";
import type { MediaService } from "~/backend/media/service";
import {
	ErrorMessage,
	importStatus,
	responseData,
	ServerRow,
	useAction,
} from "~/components/media/shared";
import {
	Button,
	EmptyState,
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
	const [selectedId, setSelectedId] = useState("");
	const [url, setUrl] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [message, setMessage] = useState("");
	const selected = servers.find((server) => server.id === selectedId);
	function select(server: Server | undefined) {
		setSelectedId(server?.id ?? "");
		setUrl(server?.url ?? "");
		setApiKey("");
		setMessage("");
		action.clearError();
	}
	return (
		<Panel
			id="jellyfin-heading"
			title={<ProviderLabel provider="jellyfin" />}
			description="Connect with a key from Jellyfin Dashboard → API Keys. The key is stored encrypted."
		>
			{servers.length > 0 ? (
				<ul
					aria-label="Saved Jellyfin servers"
					className="divide-y divide-line"
				>
					{servers.map((server) => (
						<JellyfinServerRow
							key={server.id}
							server={server}
							refresh={refresh}
							onReplaceKey={() => select(server)}
						/>
					))}
				</ul>
			) : (
				<EmptyState>No Jellyfin servers saved yet.</EmptyState>
			)}
			<form
				className="grid gap-4 border-t border-line px-5 py-4"
				onSubmit={(event) => {
					event.preventDefault();
					void action.perform(async () => {
						const input = selected
							? {
									kind: "replace" as const,
									id: selected.id,
									revision: selected.revision,
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
				<div className="flex items-center justify-between gap-3">
					<h3 className="text-sm font-medium">
						{selected ? `Replace key for ${selected.name}` : "Add a server"}
					</h3>
					{selected && (
						<Button variant="ghost" onClick={() => select(undefined)}>
							Cancel
						</Button>
					)}
				</div>
				<div className="grid gap-4 sm:grid-cols-2">
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
				</div>
				<div>
					<Button variant="primary" type="submit" disabled={action.busy}>
						{action.busy
							? "Importing…"
							: selected
								? "Replace key and import users"
								: "Connect and import users"}
					</Button>
				</div>
				<ErrorMessage message={action.error} />
				{message && <Notice tone="success">{message}</Notice>}
			</form>
		</Panel>
	);
}

function JellyfinServerRow({
	server,
	refresh,
	onReplaceKey,
}: {
	server: Server;
	refresh: () => Promise<void>;
	onReplaceKey: () => void;
}) {
	const action = useAction();
	return (
		<ServerRow
			name={server.name}
			url={server.url}
			status={importStatus(server)}
			error={action.error || server.lastError}
			actions={
				<>
					<Button variant="ghost" onClick={onReplaceKey}>
						Replace key
					</Button>
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
						{action.busy ? "Refreshing…" : "Refresh now"}
					</Button>
				</>
			}
		/>
	);
}
