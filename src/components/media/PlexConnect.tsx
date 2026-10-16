import { useEffect, useState } from "react";
import type { MediaService } from "~/backend/media/service";
import {
	ErrorMessage,
	type MediaState,
	responseData,
	SavedServer,
	SavedServerList,
	useAction,
} from "~/components/media/shared";
import {
	Button,
	buttonClass,
	Field,
	inputClass,
	Notice,
	Panel,
	ProviderLabel,
} from "~/components/ui";
import { getApi } from "~/routes/api.$";

type PlexSelection = Awaited<ReturnType<MediaService["selectPlexServer"]>>;
type Authorization =
	| { kind: "idle" }
	| {
			kind: "waiting";
			attempt: Awaited<ReturnType<MediaService["startLogin"]>>;
	  }
	| { kind: "linked"; accountId: string }
	| { kind: "failed"; message: string };

export function PlexConnect({
	account,
	servers,
	refresh,
}: {
	account: MediaState["accounts"][number] | undefined;
	servers: MediaState["plexServers"];
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
	const [disconnectId, setDisconnectId] = useState<string | null>(null);
	const selectedServer = selection?.servers.find(
		(server) => server.id === serverId,
	);
	const activeAccount =
		account &&
		authorization.kind !== "waiting" &&
		(authorization.kind !== "linked" || account.id === authorization.accountId)
			? account
			: null;

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
					setAuthorization({ kind: "linked", accountId: result.accountId });
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
		<Panel
			id="plex-heading"
			title={<ProviderLabel provider="plex" />}
			description="Sign in as the server owner, then save a server to import its users. No Plex Home PIN is needed."
		>
			<Button
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
			</Button>
			{authorization.kind === "waiting" && (
				<div className="space-y-3 rounded-md border border-line bg-raised p-4">
					<a
						href={authorization.attempt.authorizationUrl}
						target="_blank"
						rel="noopener noreferrer"
						className={buttonClass("primary")}
					>
						Continue to Plex ↗
					</a>
					<p role="status" className="text-sm text-muted">
						Finish signing in in the new tab. This page will update
						automatically.
					</p>
					<Button
						variant="ghost"
						onClick={() => setAuthorization({ kind: "idle" })}
					>
						Cancel sign-in
					</Button>
				</div>
			)}
			{authorization.kind === "linked" && (
				<Notice tone="success">Account linked. Find your servers below.</Notice>
			)}
			{authorization.kind === "failed" && (
				<ErrorMessage message={authorization.message} />
			)}
			{activeAccount && (
				<div className="space-y-3">
					<p className="text-sm text-muted">
						Signed in as <span className="text-ink">{activeAccount.name}</span>
					</p>
					<Button
						disabled={action.busy}
						onClick={() =>
							void action.perform(async () => {
								setMessage("");
								setSelection(
									responseData(
										await getApi().v1.media.plex.select.post({
											accountId: activeAccount.id,
										}),
									),
								);
								setServerId("");
								setServerUrl("");
							})
						}
					>
						{action.busy ? "Finding servers…" : "Find Plex servers"}
					</Button>
				</div>
			)}
			{activeAccount && selection && (
				<form
					className="space-y-4 border-t border-line pt-4"
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
								"Plex server saved and users imported. Open Users to pair people.",
							);
							await refresh();
						});
					}}
				>
					{selection.servers.length === 0 ? (
						<Notice tone="warning">
							No owned Plex servers were found. Sign in with the account that
							owns your server.
						</Notice>
					) : (
						<>
							<Field label="Server">
								<select
									className={inputClass}
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
							</Field>
							{selectedServer && (
								<Field label="Server address">
									<select
										className={inputClass}
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
								</Field>
							)}
							<Button
								type="submit"
								variant="primary"
								disabled={action.busy || !serverUrl}
							>
								{action.busy ? "Connecting…" : "Save server and import users"}
							</Button>
						</>
					)}
				</form>
			)}
			<ErrorMessage message={action.error} />
			{message && <Notice tone="success">{message}</Notice>}
			{servers.length > 0 && (
				<SavedServerList>
					{servers.map((server) => (
						<SavedServer
							key={server.id}
							server={server}
							status={
								server.lastSuccessAt
									? `Last imported ${new Date(server.lastSuccessAt).toLocaleString()}`
									: "Waiting for first import"
							}
						>
							<ErrorMessage message={server.lastError ?? ""} />
							{disconnectId === server.id ? (
								<fieldset
									aria-label={`Disconnect ${server.name}`}
									className="space-y-3 rounded-md border border-line bg-raised p-4 text-sm"
								>
									<p className="font-medium">Disconnect {server.name}?</p>
									<p className="text-muted">
										This removes this server's saved connection and local
										credentials. Users, mappings, manual matches, and sync
										history stay. Automatic sync for its pairings pauses. After
										reconnecting, enable automatic sync again to resume. Your
										Plex owner account stays linked for other servers.
									</p>
									<div className="flex flex-wrap gap-3">
										<Button
											variant="danger"
											disabled={action.busy}
											onClick={() =>
												void action.perform(async () => {
													responseData(
														await getApi()
															.v1.media.plex({ id: server.id })
															.delete(),
													);
													setDisconnectId(null);
													setSelection(null);
													setServerId("");
													setServerUrl("");
													setMessage(
														`${server.name} disconnected. Mappings and history are preserved. After reconnecting, enable automatic sync again to resume.`,
													);
													await refresh();
												})
											}
										>
											{action.busy ? "Disconnecting…" : "Confirm disconnect"}
										</Button>
										<Button
											disabled={action.busy}
											onClick={() => setDisconnectId(null)}
										>
											Cancel
										</Button>
									</div>
								</fieldset>
							) : (
								<Button
									disabled={action.busy}
									onClick={() => {
										setMessage("");
										setDisconnectId(server.id);
									}}
								>
									Disconnect
								</Button>
							)}
						</SavedServer>
					))}
				</SavedServerList>
			)}
		</Panel>
	);
}
