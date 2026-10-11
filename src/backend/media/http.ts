import type { z } from "zod";
import { MediaError, serverUrl } from "~/backend/media/model";

const REQUEST_TIMEOUT_MS = 15_000;
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const REDIRECTION_FIRST = 300;
const REDIRECTION_LAST = 399;

export function endpoint(base: string, path: string): URL {
	const normalized = serverUrl(base);
	return new URL(`${normalized}/${path.replace(/^\/+/, "")}`);
}

export async function requestJson<T>(input: {
	fetch: typeof globalThis.fetch;
	url: URL;
	schema: z.ZodType<T>;
	method?: "GET" | "POST" | "PUT";
	headers?: HeadersInit;
	body?: unknown;
}): Promise<T> {
	const response = await request(input);
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new MediaError("The media server returned invalid JSON.", 502);
	}
	const parsed = input.schema.safeParse(body);
	if (!parsed.success) {
		throw new MediaError(
			"The media server returned an unexpected response.",
			502,
		);
	}
	return parsed.data;
}

export async function requestEmpty(input: {
	fetch: typeof globalThis.fetch;
	url: URL;
	method: "POST" | "PUT";
	headers?: HeadersInit;
}): Promise<void> {
	await request(input);
}

export async function requestText(input: {
	fetch: typeof globalThis.fetch;
	url: URL;
	method?: "GET" | "POST" | "PUT";
	headers?: HeadersInit;
}): Promise<string> {
	return await (await request(input)).text();
}

async function request(input: {
	fetch: typeof globalThis.fetch;
	url: URL;
	method?: "GET" | "POST" | "PUT";
	headers?: HeadersInit;
	body?: unknown;
}): Promise<Response> {
	const headers = new Headers(input.headers);
	headers.set("Accept", "application/json");
	if (input.body !== undefined) headers.set("Content-Type", "application/json");
	let response: Response;
	try {
		response = await input.fetch(input.url, {
			method: input.method ?? "GET",
			headers,
			body: input.body === undefined ? undefined : JSON.stringify(input.body),
			redirect: "manual",
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === "TimeoutError")
			throw new MediaError("The media server did not respond in time.", 502);
		throw new MediaError("The media server could not be reached.", 502);
	}
	if (!response.ok) {
		// Redirects are never followed, so credentials cannot reach another host.
		if (
			response.status >= REDIRECTION_FIRST &&
			response.status <= REDIRECTION_LAST
		)
			throw new MediaError(
				"The media server redirected the request. Use the server's final URL.",
				502,
			);
		if (response.status === UNAUTHORIZED || response.status === FORBIDDEN) {
			throw new MediaError("The media server rejected these credentials.", 502);
		}
		throw new MediaError("The media server request failed.", 502);
	}
	return response;
}
