/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import { createPlexLoginService } from "~/backend/auth/plex/service";

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

describe("createPlexLoginService", () => {
	it("uses plain function fakes to create and persist a missing identifier", async () => {
		let savedIdentifier: string | undefined;
		let startedWith: string | undefined;
		const service = createPlexLoginService({
			repository: {
				findClientIdentifier: () => null,
				saveClientIdentifier: (clientIdentifier) => {
					savedIdentifier = clientIdentifier;
				},
			},
			createClientIdentifier: () => GENERATED_CLIENT_IDENTIFIER,
			client: {
				startAuth: async (clientIdentifier) => {
					startedWith = clientIdentifier;
					return successfulPlexAuth();
				},
			},
		});

		const authorizationUrl = await service.startLogin();

		expect(authorizationUrl).toBe(AUTHORIZATION_URL);
		expect(savedIdentifier).toBe(GENERATED_CLIENT_IDENTIFIER);
		expect(startedWith).toBe(GENERATED_CLIENT_IDENTIFIER);
	});

	it("reuses a stored identifier without creating or saving one", async () => {
		let createCalls = 0;
		let saveCalls = 0;
		let startedWith: string | undefined;
		const service = createPlexLoginService({
			repository: {
				findClientIdentifier: () => STORED_CLIENT_IDENTIFIER,
				saveClientIdentifier: () => {
					saveCalls += 1;
				},
			},
			createClientIdentifier: () => {
				createCalls += 1;
				return GENERATED_CLIENT_IDENTIFIER;
			},
			client: {
				startAuth: async (clientIdentifier) => {
					startedWith = clientIdentifier;
					return successfulPlexAuth();
				},
			},
		});

		await service.startLogin();

		expect(startedWith).toBe(STORED_CLIENT_IDENTIFIER);
		expect(createCalls).toBe(0);
		expect(saveCalls).toBe(0);
	});
});
