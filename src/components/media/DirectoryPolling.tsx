import { useState } from "react";
import {
	MAX_USER_POLL_MINUTES,
	MIN_USER_POLL_MINUTES,
} from "~/backend/media/constants";
import {
	ErrorMessage,
	formatTimestamp,
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
			description="Re-import users from every saved server on one schedule. Watched sync is set per pairing."
			actions={
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
									? `Refresh finished with ${failed} failed server imports. Check the server list for details.`
									: "User directories refreshed.",
							);
						})
					}
				>
					{action.busy ? "Working…" : "Refresh all users now"}
				</Button>
			}
		>
			<form
				className="flex flex-wrap items-end gap-x-6 gap-y-4 px-5 py-4"
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
				<Field label="Import interval in minutes" className="w-48">
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
				<div className="flex min-h-9 items-center">
					<Toggle
						label="Import automatically"
						checked={enabled}
						disabled={action.busy}
						onChange={(event) => setEnabled(event.target.checked)}
					/>
				</div>
				<Button variant="primary" type="submit" disabled={action.busy}>
					Save schedule
				</Button>
			</form>
			<div className="grid gap-3 border-t border-line px-5 py-3">
				<p className="text-xs text-faint">
					{settings.enabled
						? settings.nextAttemptAt > Date.now()
							? `Next import ${formatTimestamp(settings.nextAttemptAt)}, while Continuarr is running.`
							: "Imports are due on the next scheduler check, while Continuarr is running."
						: "Automatic imports are off. You can still refresh manually."}
				</p>
				<ErrorMessage message={action.error} />
				{message && <Notice tone="neutral">{message}</Notice>}
			</div>
		</Panel>
	);
}
