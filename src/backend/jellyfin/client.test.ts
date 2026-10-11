import { describe, expect, it } from "bun:test";
import { createJellyfinAdminClient } from "~/backend/jellyfin/client";
import { MediaError } from "~/backend/media/model";
import { Secret } from "~/backend/secrets/storage";

const SERVER_URL = "http://jellyfin.local/jellyfin";
const AUTHENTICATION_URL =
	"http://jellyfin.local/jellyfin/Users/AuthenticateByName";
const USERNAME = "Ian";
const PASSWORD = "private-password";
const ACCESS_TOKEN = "private-token";
const USER_ID = "user-id";
const AUTHORIZATION =
	'MediaBrowser Client="Continuarr", Device="server", DeviceId="continuarr", Version="1.0.0"';
const REQUEST_BODY = '{"Username":"Ian","Pw":"private-password"}';
const LOGIN_RESPONSE = {
	AccessToken: ACCESS_TOKEN,
	User: { Id: USER_ID, Name: USERNAME },
};
const CREDENTIALS = {
	serverUrl: SERVER_URL,
	username: USERNAME,
	password: PASSWORD,
};
const UNAUTHORIZED_STATUS = 401;
const FORBIDDEN_STATUS = 403;
const UPSTREAM_ERROR_STATUS = 502;
const INVALID_URL_STATUS = 400;
const TEST_REQUEST_TIMEOUT_MS = 5;
const UPSTREAM_DETAIL = `${PASSWORD} ${ACCESS_TOKEN} ${SERVER_URL}`;
const URL_POLICY_MESSAGE =
	"Use an HTTP or HTTPS server URL without credentials, query parameters, or fragments.";

function transport(
	handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof globalThis.fetch {
	return Object.assign(
		async (input: string | URL | Request, init?: RequestInit) =>
			handler(String(input), init),
		{ preconnect() {} },
	);
}

async function expectFailure(
	result: Promise<unknown>,
	message: string,
	status: MediaError["status"] = UPSTREAM_ERROR_STATUS,
) {
	const error: unknown = await result.catch((error: unknown) => error);
	expect(error).toBeInstanceOf(MediaError);
	if (!(error instanceof MediaError))
		throw new Error("Expected a media error.");
	expect(error.message).toBe(message);
	expect(error.status).toBe(status);
	expect(error.cause).toBeUndefined();
}

describe("Jellyfin admin client", () => {
	it("posts the exact authentication request and returns a secret token", async () => {
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		const client = createJellyfinAdminClient({
			fetch: transport((url, init) => {
				requests.push({ url, init });
				return Response.json(LOGIN_RESPONSE);
			}),
		});

		const result = await client.authenticate(CREDENTIALS);
		expect(requests.map(({ url }) => url)).toEqual([AUTHENTICATION_URL]);
		const init = requests[0]?.init;
		expect(init?.method).toBe("POST");
		expect(init?.body).toBe(REQUEST_BODY);
		expect(Object.fromEntries(new Headers(init?.headers))).toEqual({
			accept: "application/json",
			authorization: AUTHORIZATION,
			"content-type": "application/json",
		});
		expect(init?.redirect).toBe("manual");
		expect(result.serverUrl).toBe(SERVER_URL);
		expect(result.user).toEqual({ id: USER_ID, name: USERNAME });
		expect(result.accessToken).toBeInstanceOf(Secret);
		expect(result.accessToken.reveal()).toBe(ACCESS_TOKEN);
		expect(JSON.stringify(result)).toBe(
			'{"serverUrl":"http://jellyfin.local/jellyfin","accessToken":"[REDACTED]","user":{"id":"user-id","name":"Ian"}}',
		);
	});

	it.each([
		{
			input: "http://jellyfin.local/jellyfin///",
			server: "http://jellyfin.local/jellyfin",
			endpoint: "http://jellyfin.local/jellyfin/Users/AuthenticateByName",
		},
		{
			input: "HTTPS://JELLYFIN.LOCAL:443/proxy/jellyfin/",
			server: "https://jellyfin.local/proxy/jellyfin",
			endpoint:
				"https://jellyfin.local/proxy/jellyfin/Users/AuthenticateByName",
		},
		{
			input: "http://jellyfin.local/",
			server: "http://jellyfin.local",
			endpoint: "http://jellyfin.local/Users/AuthenticateByName",
		},
	])("normalizes $input while preserving the proxy path", async (testCase) => {
		const urls: string[] = [];
		const client = createJellyfinAdminClient({
			fetch: transport((url) => {
				urls.push(url);
				return Response.json(LOGIN_RESPONSE);
			}),
		});
		const result = await client.authenticate({
			...CREDENTIALS,
			serverUrl: testCase.input,
		});
		expect(urls).toEqual([testCase.endpoint]);
		expect(result.serverUrl).toBe(testCase.server);
	});

	it.each([
		{ url: "host", message: "Enter a valid server URL." },
		{ url: "file:///etc/passwd", message: URL_POLICY_MESSAGE },
		{ url: "https://user:pass@host", message: URL_POLICY_MESSAGE },
		{ url: "http://host?token=x", message: URL_POLICY_MESSAGE },
		{ url: "http://host/#x", message: URL_POLICY_MESSAGE },
	])("rejects $url before invoking transport", async ({ url, message }) => {
		const urls: string[] = [];
		const client = createJellyfinAdminClient({
			fetch: transport((url) => {
				urls.push(url);
				return Response.json(LOGIN_RESPONSE);
			}),
		});
		await expectFailure(
			client.authenticate({ ...CREDENTIALS, serverUrl: url }),
			message,
			INVALID_URL_STATUS,
		);
		expect(urls).toEqual([]);
	});

	const REDIRECT_STATUSES = [301, 302, 303, 307, 308];
	it.each(REDIRECT_STATUSES)(
		"rejects a %i redirect with manual policy and no second request",
		async (status) => {
			const requests: Array<{ url: string; redirect?: RequestRedirect }> = [];
			const client = createJellyfinAdminClient({
				fetch: transport((url, init) => {
					requests.push({ url, redirect: init?.redirect });
					return new Response(UPSTREAM_DETAIL, {
						status,
						headers: { Location: "https://redirect.example/login" },
					});
				}),
			});
			await expectFailure(
				client.authenticate(CREDENTIALS),
				"The media server request failed.",
			);
			expect(requests).toEqual([
				{ url: AUTHENTICATION_URL, redirect: "manual" },
			]);
		},
	);

	it.each([UNAUTHORIZED_STATUS, FORBIDDEN_STATUS])(
		"sanitizes a %i authentication rejection",
		async (status) => {
			const client = createJellyfinAdminClient({
				fetch: transport(() => new Response(UPSTREAM_DETAIL, { status })),
			});
			await expectFailure(
				client.authenticate(CREDENTIALS),
				"The media server rejected these credentials.",
			);
		},
	);

	it("rejects malformed JSON with a fixed message", async () => {
		const client = createJellyfinAdminClient({
			fetch: transport(() => new Response(UPSTREAM_DETAIL)),
		});
		await expectFailure(
			client.authenticate(CREDENTIALS),
			"The media server returned invalid JSON.",
		);
	});

	it.each([
		{ label: "missing token", body: { User: LOGIN_RESPONSE.User } },
		{ label: "empty token", body: { ...LOGIN_RESPONSE, AccessToken: "" } },
		{ label: "missing user", body: { AccessToken: ACCESS_TOKEN } },
		{
			label: "missing user ID",
			body: { ...LOGIN_RESPONSE, User: { Name: USERNAME } },
		},
		{
			label: "empty user ID",
			body: { ...LOGIN_RESPONSE, User: { Id: "", Name: USERNAME } },
		},
		{
			label: "missing user name",
			body: { ...LOGIN_RESPONSE, User: { Id: USER_ID } },
		},
		{
			label: "empty user name",
			body: { ...LOGIN_RESPONSE, User: { Id: USER_ID, Name: "" } },
		},
		{
			label: "wrong field type",
			body: { ...LOGIN_RESPONSE, AccessToken: null },
		},
	])("rejects a response with $label", async ({ body }) => {
		const client = createJellyfinAdminClient({
			fetch: transport(() => Response.json(body)),
		});
		await expectFailure(
			client.authenticate(CREDENTIALS),
			"The media server returned an unexpected response.",
		);
	});

	it("aborts transport using the configured request timeout", async () => {
		let requestSignal: AbortSignal | null | undefined;
		const client = createJellyfinAdminClient({
			requestTimeoutMs: TEST_REQUEST_TIMEOUT_MS,
			fetch: transport((_url, init) => {
				requestSignal = init?.signal;
				return new Promise<Response>((_resolve, reject) => {
					const signal = init?.signal;
					if (!signal) throw new Error("Expected an abort signal.");
					if (signal.aborted) reject(signal.reason);
					else
						signal.addEventListener("abort", () => reject(signal.reason), {
							once: true,
						});
				});
			}),
		});
		await expectFailure(
			client.authenticate(CREDENTIALS),
			"The media server could not be reached.",
		);
		expect(requestSignal?.aborted).toBe(true);
		expect(requestSignal?.reason).toBeInstanceOf(DOMException);
		expect(requestSignal?.reason.name).toBe("TimeoutError");
	});

	it("sanitizes thrown transport errors without retaining their cause", async () => {
		const client = createJellyfinAdminClient({
			fetch: transport(() => {
				throw new Error(UPSTREAM_DETAIL, {
					cause: { password: PASSWORD, accessToken: ACCESS_TOKEN },
				});
			}),
		});
		await expectFailure(
			client.authenticate(CREDENTIALS),
			"The media server could not be reached.",
		);
	});
});
