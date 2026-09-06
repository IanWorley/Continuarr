import { z } from "zod";

const REQUEST_TIMEOUT_MS = 10_000;
const RECENT_ITEM_LIMIT = 12;
const AUTHORIZATION =
	'MediaBrowser Client="Continuarr", Device="Continuarr Server", DeviceId="continuarr", Version="1.0.0"';
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;

export class JellyfinError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 401 | 502 = 502,
	) {
		super(message);
	}
}

export function normalizeServerUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new JellyfinError("Enter a valid Jellyfin server URL.", 400);
	}
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new JellyfinError(
			"Use an HTTP(S) URL without credentials, query, or fragment.",
			400,
		);
	}
	return url.href.replace(/\/+$/, "");
}

const userSchema = z.object({ Id: z.string().min(1), Name: z.string().min(1) });
const loginSchema = z.object({
	AccessToken: z.string().min(1),
	User: userSchema,
});
const serverSchema = z.object({
	Id: z.string(),
	ServerName: z.string(),
	Version: z.string(),
});
const itemSchema = z.object({
	Id: z.string(),
	Name: z.string(),
	Type: z.string().nullish(),
	ProductionYear: z.number().nullish(),
});
const librariesSchema = z.object({ Items: z.array(itemSchema) });
const recentSchema = z.array(itemSchema);

export interface JellyfinConnection {
	serverUrl: string;
	accessToken: string;
	user: { id: string; name: string };
}

// Keep transport injectable so protocol behavior can be tested without a server.
export function createJellyfinClient(transport: typeof fetch = fetch) {
	async function request<T>(
		serverUrl: string,
		path: string,
		schema: z.ZodType<T>,
		accessToken?: string,
		body?: { Username: string; Pw: string },
	): Promise<T> {
		let response: Response;
		try {
			response = await transport(`${normalizeServerUrl(serverUrl)}/${path}`, {
				method: body ? "POST" : "GET",
				headers: {
					Authorization: AUTHORIZATION,
					...(accessToken ? { "X-Emby-Token": accessToken } : {}),
					...(body ? { "Content-Type": "application/json" } : {}),
				},
				body: body ? JSON.stringify(body) : undefined,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				// Never forward credentials to a redirect destination.
				redirect: "error",
			});
		} catch {
			throw new JellyfinError("Unable to reach the Jellyfin server.");
		}
		if (response.status === UNAUTHORIZED || response.status === FORBIDDEN) {
			throw new JellyfinError(
				"Jellyfin rejected these credentials or this session.",
				401,
			);
		}
		if (!response.ok)
			throw new JellyfinError("Jellyfin could not complete the request.");
		try {
			return schema.parse(await response.json());
		} catch {
			throw new JellyfinError("Jellyfin returned an unexpected response.");
		}
	}

	return {
		async login(
			serverUrl: string,
			username: string,
			password: string,
		): Promise<JellyfinConnection> {
			const normalizedUrl = normalizeServerUrl(serverUrl);
			const result = await request(
				normalizedUrl,
				"Users/AuthenticateByName",
				loginSchema,
				undefined,
				{
					Username: username,
					Pw: password,
				},
			);
			return {
				serverUrl: normalizedUrl,
				accessToken: result.AccessToken,
				user: { id: result.User.Id, name: result.User.Name },
			};
		},
		async overview(connection: JellyfinConnection) {
			const { serverUrl, accessToken, user } = connection;
			const userPath = `Users/${encodeURIComponent(user.id)}`;
			const [server, libraries, recent] = await Promise.all([
				request(serverUrl, "System/Info/Public", serverSchema, accessToken),
				request(serverUrl, `${userPath}/Views`, librariesSchema, accessToken),
				request(
					serverUrl,
					`${userPath}/Items/Latest?Limit=${RECENT_ITEM_LIMIT}`,
					recentSchema,
					accessToken,
				),
			]);
			const mapItem = (item: z.infer<typeof itemSchema>) => ({
				id: item.Id,
				name: item.Name,
				type: item.Type ?? null,
				year: item.ProductionYear ?? null,
			});
			return {
				user,
				server: {
					id: server.Id,
					name: server.ServerName,
					version: server.Version,
					url: serverUrl,
				},
				libraries: libraries.Items.map(mapItem),
				recent: recent.map(mapItem),
			};
		},
	};
}

export type JellyfinClient = ReturnType<typeof createJellyfinClient>;
export type JellyfinOverview = Awaited<ReturnType<JellyfinClient["overview"]>>;
