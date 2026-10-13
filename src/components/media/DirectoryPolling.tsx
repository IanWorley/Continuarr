import { useState } from "react";
import {
	MAX_USER_POLL_MINUTES,
	MIN_USER_POLL_MINUTES,
} from "~/backend/media/constants";
import {
	ErrorMessage,
	type MediaState,
	responseData,
	useAction,
} from "~/components/media/shared";
import {
	Button,
	Field,
	inputClass,
	Notice,
	Panel,
	Toggle,
} from "~/components/ui";
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
		<Panel
			id="directory-polling-heading"
			title="Automatic user imports"
			description="Refresh users from every saved Plex and Jellyfin server on the same schedule. New users appear on Users, ready to pair. Watched sync is configured separately for each pairing."
		>
			<form
				className="flex flex-wrap items-end gap-3"
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
				<Field label="Import interval in minutes" className="w-full max-w-60">
					<input
						className={inputClass}
						type="number"
						min={MIN_USER_POLL_MINUTES}
						max={MAX_USER_POLL_MINUTES}
						required
						value={intervalMinutes}
						disabled={action.busy}
						onChange={(event) => setIntervalMinutes(Number(event.target.value))}
					/>
				</Field>
				<Toggle
					label="Import automatically"
					checked={enabled}
					disabled={action.busy}
					onChange={(event) => setEnabled(event.target.checked)}
				/>
				<Button type="submit" variant="primary" disabled={action.busy}>
					Save schedule
				</Button>
				<Button
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
				</Button>
			</form>
			<p className="text-xs text-faint">
				{settings.enabled
					? settings.nextAttemptAt > Date.now()
						? `Next scheduled import: ${new Date(settings.nextAttemptAt).toLocaleString()}. Continuarr must be running.`
						: "User imports are due on the next scheduler check. Continuarr must be running."
					: "Automatic imports are off. You can still refresh manually."}
			</p>
			<ErrorMessage message={action.error} />
			{message && <Notice tone="neutral">{message}</Notice>}
		</Panel>
	);
}
