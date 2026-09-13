import { expect, it, mock } from "bun:test";
import {
	createPlexPinClient,
	PlexUnavailableError,
	plexAuthorizationUrl,
} from "~/backend/auth/plex/client";

const CLIENT_ID = "test-client";
const PIN = {
	id: 12345,
	code: "strong+pin&code",
	expiresAt: "2027-01-15T08:05:00.000Z",
};
const SECRET = "upstream-account-token-must-not-leak";

it("requests a strong PIN with the exact client identity and strips account tokens", async () => {
	const transport = mock(async (_request: Request) =>
		Response.json({ ...PIN, authToken: SECRET }),
	);
	const result = await createPlexPinClient(transport)(CLIENT_ID);
	const sent = transport.mock.calls[0]?.[0];
	expect(sent?.url).toBe("https://plex.tv/api/v2/pins");
	expect(sent?.method).toBe("POST");
	expect(sent?.headers.get("X-Plex-Client-Identifier")).toBe(CLIENT_ID);
	expect(sent?.headers.get("X-Plex-Product")).toBe("Continuarr");
	expect(sent?.headers.get("accept")).toBe("application/json");
	expect(sent?.headers.get("X-Plex-Token")).toBeNull();
	expect(sent?.redirect).toBe("error");
	expect(await sent?.text()).toBe("strong=true");
	expect(result).toEqual(PIN);
});

it("encodes PIN and return state without changing the Plex authorization origin", () => {
	const returnUrl = new URL(
		"https://continuarr.example/plex/?state=test-state",
	);
	const url = new URL(plexAuthorizationUrl(CLIENT_ID, PIN.code, returnUrl));
	expect(url.origin).toBe("https://app.plex.tv");
	const params = new URLSearchParams(url.hash.slice("#!?".length));
	expect(params.get("clientID")).toBe(CLIENT_ID);
	expect(params.get("code")).toBe(PIN.code);
	expect(params.get("forwardUrl")).toBe(returnUrl.href);
});

it.each([
	["missing ID", { code: PIN.code, expiresAt: PIN.expiresAt }],
	["invalid ID", { ...PIN, id: -1 }],
	["missing code", { ...PIN, code: "" }],
	["invalid expiry", { ...PIN, expiresAt: "tomorrow" }],
] as const)(
	"rejects %s without revealing the upstream response",
	async (_name, body) => {
		const createPin = createPlexPinClient(async () =>
			Response.json({ ...body, authToken: SECRET }),
		);
		await expect(createPin(CLIENT_ID)).rejects.toThrow(
			new PlexUnavailableError(),
		);
	},
);

it.each(["http", "network", "invalid json", "timeout"])(
	"sanitizes %s failures",
	async (failure) => {
		const createPin = createPlexPinClient(async () => {
			if (failure === "http") return new Response(SECRET, { status: 503 });
			if (failure === "invalid json") return new Response(SECRET);
			if (failure === "timeout") throw new DOMException(SECRET, "TimeoutError");
			throw new Error(SECRET);
		});
		await expect(createPin(CLIENT_ID)).rejects.toThrow(
			new PlexUnavailableError(),
		);
	},
);
