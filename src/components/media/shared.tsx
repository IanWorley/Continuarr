import { queryOptions } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { z } from "zod";
import type { MediaService } from "~/backend/media/service";
import { Notice, StatusBadge, type Tone } from "~/components/ui";
import { getApi } from "~/routes/api.$";

export const HTTP_UNAUTHORIZED = 401;
const STATE_REFRESH_MS = 10_000;
const errorSchema = z.object({ value: z.object({ error: z.string() }) });
const timestampFormat = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeStyle: "short",
});

export const fieldClass =
	"mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 disabled:opacity-50";
export const buttonClass =
	"rounded-lg bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40";
export const secondaryClass =
	"rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40";

export type MediaState = Awaited<ReturnType<MediaService["state"]>>;

export function responseData<T>(response: {
	data: T | null;
	error: unknown;
	status: number;
}): T {
	if (response.status === HTTP_UNAUTHORIZED && typeof window !== "undefined") {
		window.location.assign("/sign-in");
	}
	if (response.error || response.data === null) {
		const parsed = errorSchema.safeParse(response.error);
		throw new Error(
			parsed.success
				? parsed.data.value.error
				: "Unable to complete this request. Please try again.",
		);
	}
	return response.data;
}

export const mediaStateQuery = queryOptions({
	queryKey: ["media-state"],
	queryFn: async () => responseData(await getApi().v1.media.state.get()),
	refetchInterval: STATE_REFRESH_MS,
});

export const jellyfinDirectoryQuery = queryOptions({
	queryKey: ["jellyfin-directory"],
	queryFn: async () =>
		responseData(await getApi().v1.media.jellyfin.directory.get()),
	refetchInterval: STATE_REFRESH_MS,
});

export function formatTimestamp(timestamp: number) {
	return timestampFormat.format(timestamp);
}

export function useAction() {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	function clearError() {
		setError("");
	}
	async function perform(action: () => Promise<void>) {
		setBusy(true);
		setError("");
		try {
			await action();
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: "Unable to complete this request. Please try again.",
			);
		} finally {
			setBusy(false);
		}
	}
	return { busy, error, clearError, perform };
}

export function ErrorMessage({ message }: { message: string }) {
	return message ? <Notice tone="danger">{message}</Notice> : null;
}

export function importStatus(server: {
	lastError: string | null;
	lastSuccessAt: number | null;
}): { tone: Tone; label: string } {
	if (server.lastError) return { tone: "danger", label: "Import failed" };
	if (server.lastSuccessAt)
		return {
			tone: "success",
			label: `Imported ${formatTimestamp(server.lastSuccessAt)}`,
		};
	return { tone: "neutral", label: "Waiting for first import" };
}

export function ServerRow({
	name,
	url,
	status,
	error,
	actions,
}: {
	name: string;
	url: string;
	status: { tone: Tone; label: string };
	error?: string | null;
	actions?: ReactNode;
}) {
	return (
		<li className="grid gap-2 px-5 py-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="min-w-0">
					<p className="text-sm font-medium">{name}</p>
					<p className="mt-0.5 font-mono text-xs break-all text-faint">{url}</p>
				</div>
				<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
					<StatusBadge tone={status.tone}>{status.label}</StatusBadge>
					{actions}
				</div>
			</div>
			<ErrorMessage message={error ?? ""} />
		</li>
	);
}
