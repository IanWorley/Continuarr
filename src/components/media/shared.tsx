import { useState } from "react";
import { z } from "zod";
import type { MediaService } from "~/backend/media/service";

export const HTTP_UNAUTHORIZED = 401;
const errorSchema = z.object({ value: z.object({ error: z.string() }) });

export type MediaState = Awaited<ReturnType<MediaService["state"]>>;

export const fieldClass =
	"mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 disabled:opacity-50";
export const buttonClass =
	"rounded-lg bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40";
export const secondaryClass =
	"rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40";

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
	return message ? (
		<p
			role="alert"
			className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200"
		>
			{message}
		</p>
	) : null;
}
