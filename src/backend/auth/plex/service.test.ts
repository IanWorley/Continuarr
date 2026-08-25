/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import { createStartPlexLogin } from "~/backend/auth/plex/service";

const CLIENT_IDENTIFIER_SETTING_KEY = "plex_login_client_identifier";
const GENERATED_CLIENT_IDENTIFIER = "generated-client-identifier";
const STORED_CLIENT_IDENTIFIER = "stored-client-identifier";
const AUTHORIZATION_URL = "https://app.plex.tv/auth/example";

function successfulPlexAuth() {
	return {
		data: {
			authorizationUrl: AUTHORIZATION_URL,
		},
	};
}

describe("createStartPlexLogin", () => {
	it("uses plain function fakes to create and persist a missing identifier", async () => {
		const savedSettings = new Map<string, string>();
		let startedWith: string | undefined;
		const startPlexLogin = createStartPlexLogin({
			findApplicationSetting: (key) => {
				const value = savedSettings.get(key);
				return value ? { value } : null;
			},
			saveApplicationSetting: (key, value) => savedSettings.set(key, value),
			createClientIdentifier: () => GENERATED_CLIENT_IDENTIFIER,
			startPlexAuth: async (clientIdentifier) => {
				startedWith = clientIdentifier;
				return successfulPlexAuth();
			},
		});

		const authorizationUrl = await startPlexLogin();

		expect(authorizationUrl).toBe(AUTHORIZATION_URL);
		expect(savedSettings.get(CLIENT_IDENTIFIER_SETTING_KEY)).toBe(
			GENERATED_CLIENT_IDENTIFIER,
		);
		expect(startedWith).toBe(GENERATED_CLIENT_IDENTIFIER);
	});

	it("reuses a stored identifier without creating or saving one", async () => {
		let createCalls = 0;
		let saveCalls = 0;
		let startedWith: string | undefined;
		const startPlexLogin = createStartPlexLogin({
			findApplicationSetting: () => ({ value: STORED_CLIENT_IDENTIFIER }),
			saveApplicationSetting: () => {
				saveCalls += 1;
			},
			createClientIdentifier: () => {
				createCalls += 1;
				return GENERATED_CLIENT_IDENTIFIER;
			},
			startPlexAuth: async (clientIdentifier) => {
				startedWith = clientIdentifier;
				return successfulPlexAuth();
			},
		});

		await startPlexLogin();

		expect(startedWith).toBe(STORED_CLIENT_IDENTIFIER);
		expect(createCalls).toBe(0);
		expect(saveCalls).toBe(0);
	});
});
