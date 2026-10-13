import { type ReactNode, useState } from "react";
import { z } from "zod";
import type { MediaService } from "~/backend/media/service";
import { Notice, StatusBadge, type Tone } from "~/components/ui";

export const HTTP_UNAUTHORIZED = 401;
const errorSchema = z.object({ value: z.object({ error: z.string() }) });

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

export function SavedServerList({ children }: { children: ReactNode }) {
	return (
		<div className="border-t border-line pt-4">
			<h3 className="text-xs font-medium uppercase tracking-wider text-faint">
				Saved servers
			</h3>
			<ul className="mt-1 divide-y divide-line">{children}</ul>
		</div>
	);
}

type SavedServerHealth = {
	name: string;
	url: string;
	lastError: string | null;
	lastSuccessAt: number | null;
};

export function SavedServer({
	server,
	status,
	detail,
	children,
}: {
	server: SavedServerHealth;
	status: string;
	detail?: string;
	children?: ReactNode;
}) {
	const tone: Tone = server.lastError
		? "danger"
		: server.lastSuccessAt
			? "success"
			: "neutral";
	return (
		<li className="space-y-3 py-3 last:pb-0">
			<div className="grid gap-1 text-sm">
				<h4 className="font-medium">{server.name}</h4>
				<p className="break-all text-faint">{server.url}</p>
				<StatusBadge tone={tone}>{status}</StatusBadge>
				{detail && <p className="text-xs text-faint">{detail}</p>}
			</div>
			{children}
		</li>
	);
}
