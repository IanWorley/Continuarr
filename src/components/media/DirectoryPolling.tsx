import { useState } from "react";
import {
	MAX_USER_POLL_MINUTES,
	MIN_USER_POLL_MINUTES,
} from "~/backend/media/constants";
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

export function DirectoryPolling({
	settings,
	refresh,
}: {
	settings: MediaState["directoryPolling"];
	refresh: () => Promise<void>;
}) {
	const action = useAction();
	const [enabled, setEnabled] = useState(settings.enabled);
	const [intervalMinutes, setIntervalMinutes] = useState(
		settings.intervalMinutes,
	);
	const [message, setMessage] = useState("");
	return (
		<section
			aria-labelledby="directory-polling-heading"
			className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6"
		>
			<h2 id="directory-polling-heading" className="text-lg font-semibold">
				Automatic user imports
			</h2>
			<p className="mt-2 text-sm leading-6 text-slate-400">
				Refresh users from every saved Plex and Jellyfin server on the same
				schedule. New users appear on Users, ready to pair. Watched sync is
				configured separately for each pairing.
			</p>
			<form
				className="mt-5 flex flex-wrap items-end gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					void action.perform(async () => {
						setMessage("");
						responseData(
							await getApi().v1.media.directory.polling.post({
								enabled,
								intervalMinutes,
							}),
						);
						await refresh();
						setMessage("User import schedule saved.");
					});
				}}
			>
				<label className="text-sm text-slate-300">
					Import interval in minutes
					<input
						className={`${fieldClass} max-w-60`}
						type="number"
						min={MIN_USER_POLL_MINUTES}
						max={MAX_USER_POLL_MINUTES}
						required
						value={intervalMinutes}
						disabled={action.busy}
						onChange={(event) => setIntervalMinutes(Number(event.target.value))}
					/>
				</label>
				<label className="flex min-h-11 items-center gap-2 text-sm text-slate-300">
					<input
						type="checkbox"
						className="size-4 accent-cyan-300"
						checked={enabled}
						disabled={action.busy}
						onChange={(event) => setEnabled(event.target.checked)}
					/>
					Import automatically
				</label>
				<button className={buttonClass} type="submit" disabled={action.busy}>
					Save schedule
				</button>
				<button
					className={secondaryClass}
					type="button"
					disabled={action.busy}
					onClick={() =>
						void action.perform(async () => {
							setMessage("");
							const result = responseData(
								await getApi().v1.media.directory.refresh.post(),
							);
							await refresh();
							const failed = result.results.filter(
								(entry) => entry.result.kind === "failed",
							).length;
							setMessage(
								failed
									? `Refresh finished with ${failed} failed server imports. Check the server cards for details.`
									: "User directories refreshed.",
							);
						})
					}
				>
					{action.busy ? "Working…" : "Refresh all users now"}
				</button>
			</form>
			<p className="mt-4 text-xs text-slate-500">
				{settings.enabled
					? settings.nextAttemptAt > Date.now()
						? `Next scheduled import: ${new Date(settings.nextAttemptAt).toLocaleString()}. Continuarr must be running.`
						: "User imports are due on the next scheduler check. Continuarr must be running."
					: "Automatic imports are off. You can still refresh manually."}
			</p>
			<ErrorMessage message={action.error} />
			{message && (
				<p role="status" className="mt-3 text-sm text-slate-300">
					{message}
				</p>
			)}
		</section>
	);
}
