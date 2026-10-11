/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import { createJellyfinProvider } from "~/backend/media/jellyfin";
import { MediaError } from "~/backend/media/model";
import { Secret } from "~/backend/secrets/storage";

const CLIENT_IDENTIFIER = "device-1";
const SERVER_ID = "server-1";
const PASSWORD = "hunter2";
const ACCESS_TOKEN = "admin-token";
const CREDENTIALS = {
	url: "https://media.example/jellyfin/",
	username: "Admin",
	password: new Secret(PASSWORD),
};
const UNAUTHORIZED = 401;
const FOUND = 302;
const SERVER_ERROR = 500;

type Call = { url: string; init: RequestInit | undefined };

function authenticationBody(
	overrides: { userServerId?: string; admin?: boolean } = {},
) {
	return {
		AccessToken: ACCESS_TOKEN,
		ServerId: SERVER_ID,
		User: {
			Id: "user-1",
			Name: "Admin",
			ServerId: overrides.userServerId ?? SERVER_ID,
			Policy: { IsAdministrator: overrides.admin ?? true },
		},
	};
}

function provider(
	respond: (call: Call) => Response | Promise<Response> = () =>
		Response.json(authenticationBody()),
) {
	const calls: Call[] = [];
	const transport = Object.assign(
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const call = { url: String(input), init };
			calls.push(call);
			return respond(call);
		},
		{ preconnect: fetch.preconnect },
	);
	return {
		calls,
		jellyfin: createJellyfinProvider({
			clientIdentifier: CLIENT_IDENTIFIER,
			fetch: transport,
		}),
	};
}

async function failure(promise: Promise<unknown>) {
	const error = await promise.then(
		() => undefined,
		(reason: unknown) => reason,
	);
	if (!(error instanceof MediaError))
		throw new Error(`Expected a MediaError, received ${String(error)}`);
	return { message: error.message, status: error.status, cause: error.cause };
}

describe("Jellyfin authentication", () => {
	it("signs in by name and returns the server, user, and redacted token", async () => {
		const { calls, jellyfin } = provider();

		const connection = await jellyfin.authenticate(CREDENTIALS);

		expect(calls).toHaveLength(1);
		const [{ url, init }] = calls;
		expect(url).toBe("https://media.example/jellyfin/Users/AuthenticateByName");
		expect(init?.method).toBe("POST");
		expect(init?.body).toBe('{"Username":"Admin","Pw":"hunter2"}');
		expect(new Headers(init?.headers).get("Authorization")).toBe(
			'MediaBrowser Client="Continuarr", Device="server", DeviceId="device-1", Version="1.0.0"',
		);
		expect(connection.access.token.reveal()).toBe(ACCESS_TOKEN);
		expect(JSON.stringify(connection)).toBe(
			'{"serverId":"server-1","user":{"id":"user-1","name":"Admin"},"access":{"url":"https://media.example/jellyfin","token":"[REDACTED]"}}',
		);
	});

	it.each([
		["HTTPS://Media.Example:443/jellyfin//", "https://media.example/jellyfin"],
		["http://10.0.0.5:8096", "http://10.0.0.5:8096"],
		["http://proxy.local/apps/jellyfin/", "http://proxy.local/apps/jellyfin"],
	])("normalizes %s and keeps its base path", async (input, normalized) => {
		const { calls, jellyfin } = provider();

		const connection = await jellyfin.authenticate({
			...CREDENTIALS,
			url: input,
		});

		expect(connection.access.url).toBe(normalized);
		expect(calls.map(({ url }) => url)).toEqual([
			`${normalized}/Users/AuthenticateByName`,
		]);
	});

	it.each([
		["not a url", "Enter a valid server URL."],
		[
			"https://user:pass@media.example",
			"Use an HTTP or HTTPS server URL without credentials, query parameters, or fragments.",
		],
		[
			"ftp://media.example",
			"Use an HTTP or HTTPS server URL without credentials, query parameters, or fragments.",
		],
	])("rejects %s before sending credentials", async (input, message) => {
		const { calls, jellyfin } = provider();

		const error = await failure(
			jellyfin.authenticate({ ...CREDENTIALS, url: input }),
		);

		expect(error.message).toBe(message);
		expect(calls.map(({ url }) => url)).toEqual([]);
	});

	it("reports rejected credentials without echoing them", async () => {
		const { jellyfin } = provider(
			() => new Response(`bad password ${PASSWORD}`, { status: UNAUTHORIZED }),
		);

		expect(await failure(jellyfin.authenticate(CREDENTIALS))).toEqual({
			message: "The media server rejected these credentials.",
			status: 502,
			cause: undefined,
		});
	});

	it("refuses to follow a redirect with the password", async () => {
		const { calls, jellyfin } = provider(
			() =>
				new Response(null, {
					status: FOUND,
					headers: { Location: "https://elsewhere.example/" },
				}),
		);

		const error = await failure(jellyfin.authenticate(CREDENTIALS));

		expect(error.message).toBe(
			"The media server redirected the request. Use the server's final URL.",
		);
		expect(calls.map(({ init }) => init?.redirect)).toEqual(["manual"]);
	});

	it("reports a timeout separately from an unreachable server", async () => {
		const timedOut = provider(() => {
			throw new DOMException("The operation timed out.", "TimeoutError");
		});
		const unreachable = provider(() => {
			throw new TypeError(`connect ECONNREFUSED ${PASSWORD}`);
		});

		expect(
			(await failure(timedOut.jellyfin.authenticate(CREDENTIALS))).message,
		).toBe("The media server did not respond in time.");
		expect(
			await failure(unreachable.jellyfin.authenticate(CREDENTIALS)),
		).toEqual({
			message: "The media server could not be reached.",
			status: 502,
			cause: undefined,
		});
		expect(timedOut.calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
	});

	it.each([
		[
			"invalid JSON",
			() => new Response("<html>"),
			"The media server returned invalid JSON.",
		],
		[
			"a missing token",
			() => Response.json({ ...authenticationBody(), AccessToken: "" }),
			"The media server returned an unexpected response.",
		],
		[
			"a user from another server",
			() => Response.json(authenticationBody({ userServerId: "server-2" })),
			"Jellyfin returned a user from a different server.",
		],
		[
			"a server error",
			() => new Response(PASSWORD, { status: SERVER_ERROR }),
			"The media server request failed.",
		],
	])("rejects %s", async (_label, respond, message) => {
		const { jellyfin } = provider(respond);

		expect(await failure(jellyfin.authenticate(CREDENTIALS))).toEqual({
			message,
			status: 502,
			cause: undefined,
		});
	});

	it("rejects an account without administrator rights", async () => {
		const { jellyfin } = provider(() =>
			Response.json(authenticationBody({ admin: false })),
		);

		expect(await failure(jellyfin.authenticate(CREDENTIALS))).toEqual({
			message: "Sign in with a Jellyfin administrator account.",
			status: 400,
			cause: undefined,
		});
	});
});
