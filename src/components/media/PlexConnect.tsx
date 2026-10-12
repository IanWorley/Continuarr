import { useEffect, useState } from "react";
import type { MediaService } from "~/backend/media/service";
import {
	ErrorMessage,
	importStatus,
	type MediaState,
	responseData,
	ServerRow,
	useAction,
} from "~/components/media/shared";
import {
	Button,
	buttonClass,
	EmptyState,
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
			description={
				activeAccount
					? `Signed in as ${activeAccount.name}`
					: "Sign in as the server owner to import its users. No Plex Home PIN is needed."
			}
			actions={
				<div className="flex flex-wrap gap-2">
					{activeAccount && (
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
					)}
					<Button
						variant={activeAccount ? "ghost" : "primary"}
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
				</div>
			}
		>
			{servers.length > 0 ? (
				<ul aria-label="Saved Plex servers" className="divide-y divide-line">
					{servers.map((server) => (
						<ServerRow
							key={server.id}
							name={server.name}
							url={server.url}
							status={importStatus(server)}
							error={server.lastError}
						/>
					))}
				</ul>
			) : (
				<EmptyState>No Plex servers saved yet.</EmptyState>
			)}
			{authorization.kind === "waiting" && (
				<div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
					<a
						href={authorization.attempt.authorizationUrl}
						target="_blank"
						rel="noopener noreferrer"
						className={buttonClass("primary")}
					>
						Continue to Plex ↗
					</a>
					<p role="status" className="text-sm text-muted">
						Finish signing in in the new tab. This page updates automatically.
					</p>
					<Button
						variant="ghost"
						className="ml-auto"
						onClick={() => setAuthorization({ kind: "idle" })}
					>
						Cancel sign-in
					</Button>
				</div>
			)}
			{activeAccount && selection && (
				<form
					className="grid gap-4 border-t border-line px-5 py-4"
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
							<div className="grid gap-4 sm:grid-cols-2">
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
								<Field label="Server address">
									<select
										className={inputClass}
										required
										value={serverUrl}
										disabled={action.busy || !selectedServer}
										onChange={(event) => setServerUrl(event.target.value)}
									>
										<option value="">
											Choose an address reachable by Continuarr
										</option>
										{selectedServer?.connections.map((url) => (
											<option key={url} value={url}>
												{url}
											</option>
										))}
									</select>
								</Field>
							</div>
							<div>
								<Button
									variant="primary"
									type="submit"
									disabled={action.busy || !serverUrl}
								>
									{action.busy ? "Connecting…" : "Save server and import users"}
								</Button>
							</div>
						</>
					)}
				</form>
			)}
			{(authorization.kind === "linked" ||
				authorization.kind === "failed" ||
				action.error ||
				message) && (
				<div className="grid gap-3 border-t border-line px-5 py-4">
					{authorization.kind === "linked" && (
						<Notice tone="success">
							Account linked. Choose Find Plex servers to continue.
						</Notice>
					)}
					{authorization.kind === "failed" && (
						<ErrorMessage message={authorization.message} />
					)}
					<ErrorMessage message={action.error} />
					{message && <Notice tone="success">{message}</Notice>}
				</div>
			)}
		</Panel>
	);
}
