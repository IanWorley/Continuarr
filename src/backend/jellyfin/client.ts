import { z } from "zod";
import { jellyfinHeaders } from "~/backend/jellyfin/headers";
import { endpoint, requestJson } from "~/backend/media/http";
import { serverUrl } from "~/backend/media/model";
import { Secret } from "~/backend/secrets/storage";

const DEFAULT_CLIENT_IDENTIFIER = "continuarr";
const AUTHENTICATION_PATH = "Users/AuthenticateByName";

const authenticationSchema = z.object({
	AccessToken: z.string().min(1),
	User: z.object({
		Id: z.string().min(1),
		Name: z.string().min(1),
	}),
});

export type JellyfinAdminCredentials = {
	serverUrl: string;
	username: string;
	password: string;
};

export type JellyfinAdminConnection = {
	serverUrl: string;
	accessToken: Secret;
	user: { id: string; name: string };
};

export function createJellyfinAdminClient(
	options: {
		fetch?: typeof globalThis.fetch;
		clientIdentifier?: string;
		requestTimeoutMs?: number;
	} = {},
) {
	const fetcher = options.fetch ?? globalThis.fetch;
	const clientIdentifier =
		options.clientIdentifier ?? DEFAULT_CLIENT_IDENTIFIER;

	return {
		async authenticate(
			input: JellyfinAdminCredentials,
		): Promise<JellyfinAdminConnection> {
			const normalizedUrl = serverUrl(input.serverUrl);
			const result = await requestJson({
				fetch: fetcher,
				url: endpoint(normalizedUrl, AUTHENTICATION_PATH),
				method: "POST",
				headers: jellyfinHeaders(clientIdentifier),
				body: { Username: input.username, Pw: input.password },
				schema: authenticationSchema,
				requestTimeoutMs: options.requestTimeoutMs,
			});
			return {
				serverUrl: normalizedUrl,
				accessToken: new Secret(result.AccessToken),
				user: { id: result.User.Id, name: result.User.Name },
			};
		},
	};
}

export type JellyfinAdminClient = ReturnType<typeof createJellyfinAdminClient>;
