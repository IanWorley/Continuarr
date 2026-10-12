/// <reference types="bun" />

import { describe, expect, it, jest } from "bun:test";
import { REQUEST_TIMEOUT_MS } from "~/backend/media/http";
import { createJellyfinProvider } from "~/backend/media/jellyfin";
import { Secret } from "~/backend/secrets/storage";

const SERVER_URL = "https://media.example/jellyfin";
const AUTHENTICATE_URL = `${SERVER_URL}/Users/AuthenticateByName`;
const SYSTEM_INFO_URL = `${SERVER_URL}/System/Info`;
const USERNAME = "Ian";
const PASSWORD = "correct-password";
const ACCESS_TOKEN = "admin-session-token";
const ADMINISTRATOR = {
	AccessToken: ACCESS_TOKEN,
	User: { Id: "admin-id", Name: USERNAME, Policy: { IsAdministrator: true } },
};
const SYSTEM_INFO = { Id: "server-id", ServerName: "Home Media" };

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function transport(handler: Handler): typeof fetch {
	return Object.assign(
		async (input: string | URL | Request, init?: RequestInit) =>
			handler(String(input), init ?? {}),
		{ preconnect() {} },
	);
}

function jellyfinServer(authentication: unknown = ADMINISTRATOR): Handler {
	return (url, init) => {
		if (url === AUTHENTICATE_URL && init.method === "POST") {
			const { Username, Pw } = JSON.parse(String(init.body));
			return Username === USERNAME && Pw === PASSWORD
				? Response.json(authentication)
				: Response.json({ detail: `Invalid password ${Pw}` }, { status: 401 });
		}
		const authorization = new Headers(init.headers).get("Authorization");
		if (url === SYSTEM_INFO_URL && authorization?.includes(ACCESS_TOKEN))
			return Response.json(SYSTEM_INFO);
		return new Response(null, { status: 404 });
	};
}

function authenticate(handler: Handler, url = SERVER_URL, password = PASSWORD) {
	return createJellyfinProvider({
		clientIdentifier: "jellyfin-client",
		fetch: transport(handler),
	}).authenticate({ url, username: USERNAME, password: new Secret(password) });
}

describe("Jellyfin administrator authentication", () => {
	it("returns the server, user, and token under a reverse proxy base path", async () => {
		const connection = await authenticate(jellyfinServer(), `${SERVER_URL}/`);
		expect({
			server: connection.server,
			user: connection.user,
			url: connection.access.url,
			token: connection.access.token.reveal(),
		}).toEqual({
			server: { id: "server-id", name: "Home Media" },
			user: { id: "admin-id", name: USERNAME },
			url: SERVER_URL,
			token: ACCESS_TOKEN,
		});
	});

	it("rejects a server URL with embedded credentials before sending the password", async () => {
		let contacted = false;
		await expect(
			authenticate(() => {
				contacted = true;
				return Response.json(ADMINISTRATOR);
			}, "https://ian:secret@media.example/jellyfin"),
		).rejects.toThrow(
			"Use an HTTP or HTTPS server URL without credentials, query parameters, or fragments.",
		);
		expect(contacted).toBe(false);
	});

	it("does not follow a redirect that would resend the password", async () => {
		const leakedPasswords: string[] = [];
		const followingServer: Handler = (url, init) => {
			if (url !== AUTHENTICATE_URL) {
				leakedPasswords.push(JSON.parse(String(init.body)).Pw);
				return Response.json(ADMINISTRATOR);
			}
			const redirect = Response.redirect("https://capture.example/login", 307);
			return init.redirect === "manual" || init.redirect === "error"
				? redirect
				: followingServer("https://capture.example/login", init);
		};
		await expect(authenticate(followingServer)).rejects.toThrow(
			"The media server redirected this request. Enter the server's final URL.",
		);
		expect(leakedPasswords).toEqual([]);
	});

	it("reports rejected credentials without echoing the server's response", async () => {
		await expect(
			authenticate(jellyfinServer(), SERVER_URL, "wrong-password"),
		).rejects.toMatchObject({
			message: "The media server rejected these credentials.",
		});
	});

	it("rejects an account that cannot administer the server", async () => {
		await expect(
			authenticate(
				jellyfinServer({
					...ADMINISTRATOR,
					User: { ...ADMINISTRATOR.User, Policy: { IsAdministrator: false } },
				}),
			),
		).rejects.toThrow("Sign in with a Jellyfin administrator account.");
	});

	it("rejects an authentication response without an access token", async () => {
		await expect(
			authenticate(jellyfinServer({ User: ADMINISTRATOR.User })),
		).rejects.toThrow("The media server returned an unexpected response.");
	});

	it("reports a timed out request without exposing the transport error", async () => {
		await expect(
			authenticate(() => {
				throw new DOMException("The operation timed out.", "TimeoutError");
			}),
		).rejects.toMatchObject({
			message: "The media server did not respond in time.",
		});
	});

	it("reports a response body that stalls past the request timeout as a timeout", async () => {
		jest.useFakeTimers();
		try {
			const signIn = authenticate((_url, init) => {
				const signal = init.signal;
				if (!signal) throw new Error("The request has no timeout signal.");
				return new Response(
					new ReadableStream({
						start(controller) {
							signal.addEventListener("abort", () =>
								controller.error(signal.reason),
							);
						},
					}),
					{ headers: { "Content-Type": "application/json" } },
				);
			});
			jest.advanceTimersByTime(REQUEST_TIMEOUT_MS);
			await expect(signIn).rejects.toMatchObject({
				message: "The media server did not respond in time.",
			});
		} finally {
			jest.useRealTimers();
		}
	});
});
