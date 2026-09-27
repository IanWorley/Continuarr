import { useState } from "react";
import {
	MAX_USER_POLL_MINUTES,
	MIN_USER_POLL_MINUTES,
} from "~/backend/media/constants";
import type { MediaService } from "~/backend/media/service";
import {
	buttonClass,
	ErrorMessage,
	fieldClass,
	responseData,
	secondaryClass,
	useAction,
} from "~/components/media/shared";
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
	return (
		<section
			aria-labelledby="jellyfin-heading"
			className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6"
		>
			<h2 id="jellyfin-heading" className="text-xl font-semibold">
				Jellyfin server
			</h2>
			<p className="mt-2 text-sm text-slate-400">
				Create a server API key in Jellyfin Dashboard → API Keys. One connection
				imports every user and stores the key encrypted.
			</p>
			<form
				className="mt-5 space-y-4"
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
						setMessage(
							"Jellyfin users imported. Choose a person below to pair.",
						);
						await refresh();
					});
				}}
			>
				{servers.length > 0 && (
					<label className="block text-sm text-slate-300">
						Connection
						<select
							className={fieldClass}
							value={selectedId}
							onChange={(event) => {
								const id = event.target.value;
								setSelectedId(id);
								setUrl(servers.find((server) => server.id === id)?.url ?? "");
								setApiKey("");
								setMessage("");
							}}
						>
							<option value="">Add another server</option>
							{servers.map((server) => (
								<option key={server.id} value={server.id}>
									{server.name} · {server.url} (replace key)
								</option>
							))}
						</select>
					</label>
				)}
				<label className="block text-sm text-slate-300">
					Server URL
					<input
						className={fieldClass}
						type="url"
						value={url}
						required
						autoComplete="url"
						placeholder="http://jellyfin.local:8096"
						onChange={(event) => setUrl(event.target.value)}
					/>
				</label>
				<label className="block text-sm text-slate-300">
					API key
					<input
						className={fieldClass}
						type="password"
						value={apiKey}
						required
						autoComplete="off"
						onChange={(event) => setApiKey(event.target.value)}
					/>
				</label>
				<button type="submit" className={buttonClass} disabled={action.busy}>
					{action.busy
						? "Importing…"
						: selected
							? "Replace key and import users"
							: "Connect and import users"}
				</button>
				<ErrorMessage message={action.error} />
				{message && (
					<p role="status" className="text-sm text-emerald-300">
						{message}
					</p>
				)}
			</form>
		</section>
	);
}

export function JellyfinServerCard({
	server,
	refresh,
}: {
	server: Server;
	refresh: () => Promise<void>;
}) {
	const action = useAction();
	const [minutes, setMinutes] = useState(server.intervalMinutes);
	return (
		<article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
			<h3 className="font-semibold">{server.name}</h3>
			<p className="mt-1 break-all text-sm text-slate-400">{server.url}</p>
			<p className="mt-2 text-sm text-slate-300">
				{server.lastError
					? `Last refresh failed: ${server.lastError}`
					: server.lastSuccessAt
						? `Last refreshed ${new Date(server.lastSuccessAt).toLocaleString()}`
						: "Waiting for first refresh"}
			</p>
			<p className="mt-1 text-xs text-slate-500">
				{server.lastAttemptAt
					? `Last attempt ${new Date(server.lastAttemptAt).toLocaleString()}`
					: "No attempt yet"}
			</p>
			<div className="mt-4 flex flex-wrap items-end gap-3">
				<label className="text-sm text-slate-300">
					Import interval in minutes
					<input
						className={`${fieldClass} w-36`}
						type="number"
						min={MIN_USER_POLL_MINUTES}
						max={MAX_USER_POLL_MINUTES}
						value={minutes}
						onChange={(event) => setMinutes(Number(event.target.value))}
					/>
				</label>
				<button
					type="button"
					className={secondaryClass}
					disabled={action.busy}
					onClick={() =>
						void action.perform(async () => {
							responseData(
								await getApi()
									.v1.media.jellyfin({ id: server.id })
									.polling.post({
										enabled: server.pollEnabled,
										intervalMinutes: minutes,
									}),
							);
							await refresh();
						})
					}
				>
					Save interval
				</button>
				<label className="flex items-center gap-2 text-sm text-slate-300">
					<input
						type="checkbox"
						checked={server.pollEnabled}
						disabled={action.busy}
						onChange={(event) => {
							const enabled = event.target.checked;
							void action.perform(async () => {
								responseData(
									await getApi()
										.v1.media.jellyfin({ id: server.id })
										.polling.post({ enabled, intervalMinutes: minutes }),
								);
								await refresh();
							});
						}}
					/>{" "}
					Import automatically
				</label>
				<button
					type="button"
					className={secondaryClass}
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
				</button>
			</div>
			<ErrorMessage message={action.error} />
		</article>
	);
}
