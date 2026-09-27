import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { MediaService } from "~/backend/media/service";
import {
	buttonClass,
	ErrorMessage,
	fieldClass,
	type MediaState,
	responseData,
	secondaryClass,
	useAction,
} from "~/components/media/shared";
import { getApi } from "~/routes/api.$";

type PlexSelection = Awaited<ReturnType<MediaService["selectProfile"]>>;
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
	const [userId, setUserId] = useState("");
	const [pin, setPin] = useState("");
	const selectedServer = selection?.servers.find(
		(server) => server.id === serverId,
	);
	const activeAccount =
		account &&
		authorization.kind !== "waiting" &&
		(authorization.kind !== "linked" || account.id === authorization.accountId)
			? account
			: null;

	const directory = useQuery({
		queryKey: ["plex-users", activeAccount?.id],
		enabled: !!activeAccount,
		queryFn: async () => {
			if (!activeAccount) throw new Error("Sign in to Plex first.");
			return responseData(
				await getApi().v1.media.plex({ id: activeAccount.id }).users.get(),
			);
		},
	});
	const chosenUser = directory.data?.users.find((user) => user.id === userId);

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
					setUserId("");
					setPin("");
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
					Choose your account, a Plex Home member, or a shared user, then find
					their server.
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
						Account linked. Choose a person below.
					</p>
				)}
				{authorization.kind === "failed" && (
					<ErrorMessage message={authorization.message} />
				)}
				{activeAccount && (
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							void action.perform(async () => {
								setMessage("");
								const result = responseData(
									await getApi().v1.media.plex.select.post({
										accountId: activeAccount.id,
										userId,
										pin:
											chosenUser?.kind === "home" && chosenUser.protected
												? pin
												: undefined,
									}),
								);
								setSelection(result);
								setPin("");
								setServerId("");
								setServerUrl("");
							});
						}}
					>
						<label className="block text-sm text-slate-300" htmlFor="plex-user">
							Plex user
							<select
								id="plex-user"
								className={fieldClass}
								value={userId}
								required
								disabled={action.busy || directory.isPending}
								onChange={(event) => {
									setUserId(event.target.value);
									setPin("");
									setSelection(null);
									setMessage("");
								}}
							>
								<option value="">
									{directory.isPending
										? "Loading Plex users…"
										: "Choose a person"}
								</option>
								{directory.data?.users.map((user) => (
									<option key={user.id} value={user.id}>
										{user.name} ·{" "}
										{user.kind === "owner"
											? "Signed-in account"
											: user.kind === "home"
												? "Plex Home"
												: "Shared user"}
									</option>
								))}
							</select>
						</label>
						{chosenUser?.kind === "home" && chosenUser.protected && (
							<label
								className="block text-sm text-slate-300"
								htmlFor="plex-home-pin"
							>
								Plex Home PIN
								<input
									id="plex-home-pin"
									className={fieldClass}
									type="password"
									inputMode="numeric"
									autoComplete="off"
									required
									value={pin}
									disabled={action.busy}
									onChange={(event) => setPin(event.target.value)}
								/>
							</label>
						)}
						{directory.error && (
							<ErrorMessage message={directory.error.message} />
						)}
						{directory.data?.issues.map((issue) => (
							<ErrorMessage key={issue} message={issue} />
						))}
						<button
							type="button"
							className="block text-sm text-slate-400 underline underline-offset-4"
							disabled={directory.isFetching}
							onClick={() => void directory.refetch()}
						>
							Refresh Plex users
						</button>
						<button
							type="submit"
							className={secondaryClass}
							disabled={action.busy || !chosenUser}
						>
							{action.busy ? "Checking profile…" : "Find Plex servers"}
						</button>
					</form>
				)}
				{activeAccount && selection && (
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
