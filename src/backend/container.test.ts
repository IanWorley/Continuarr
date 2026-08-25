/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import { createApi } from "~/backend/api";
import {
	type BackendDatabaseResource,
	createBackendContainer,
} from "~/backend/container";

const API_ORIGIN = "http://localhost";
const AUTHORIZATION_URL = "https://app.plex.tv/auth/example";
const GENERATED_CLIENT_IDENTIFIER = "integration-client-identifier";

function createTestLayer() {
	const settings = new Map<string, string>();
	const startedIdentifiers: string[] = [];
	let closeCalls = 0;
	const databaseResource: BackendDatabaseResource = {
		applicationSettingsRepository: {
			findApplicationSetting: (key) => {
				const value = settings.get(key);
				if (value === undefined) {
					return null;
				}

				return { value };
			},
			saveApplicationSetting: (key, value) => settings.set(key, value),
		},
		close: () => {
			closeCalls += 1;
		},
	};
	const container = createBackendContainer({
		createDatabaseResource: () => databaseResource,
		createClientIdentifier: () => GENERATED_CLIENT_IDENTIFIER,
		startPlexAuth: async (clientIdentifier) => {
			startedIdentifiers.push(clientIdentifier);
			return { data: { authorizationUrl: AUTHORIZATION_URL } };
		},
	});

	return {
		container,
		settings,
		startedIdentifiers,
		getCloseCalls: () => closeCalls,
	};
}

describe("ITI backend container", () => {
	it("composes the HTTP route, business function, and test layer", async () => {
		const { container, settings, startedIdentifiers } = createTestLayer();
		const api = createApi({
			startPlexLogin: container.get("startPlexLogin"),
		});

		try {
			const response = await api.handle(
				new Request(`${API_ORIGIN}/api/v1/auth/plex/login/start`),
			);

			expect(response.status).toBe(200);
			expect(await response.text()).toBe(AUTHORIZATION_URL);
			expect(startedIdentifiers).toEqual([GENERATED_CLIENT_IDENTIFIER]);
			expect(settings.get("plex_login_client_identifier")).toBe(
				GENERATED_CLIENT_IDENTIFIER,
			);
		} finally {
			await container.disposeAll();
		}
	});

	it("closes a resolved database resource when the container is disposed", async () => {
		const { container, getCloseCalls } = createTestLayer();
		container.get("databaseResource");

		await container.disposeAll();

		expect(getCloseCalls()).toBe(1);
	});
});
