import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import {
	endpoint,
	requestEmpty,
	requestJson,
	requestText,
} from "~/backend/media/http";
import {
	type MediaAccess,
	MediaError,
	type MediaItem,
	type PlexDirectoryUser,
	type PlexProvider,
} from "~/backend/media/model";
import { Secret } from "~/backend/secrets/storage";

const PLEX_ROOT = "https://plex.tv";
const PLEX_PRODUCT = "Continuarr";
const PLEX_PLATFORM = "server";
const PLEX_VERSION = "1.0.0";
const PAGE_SIZE = 100;
const LIBRARY_IDENTIFIER = "com.plexapp.plugins.library";

const pinSchema = z.object({
	id: z.number().int(),
	code: z.string().min(1),
	expiresIn: z.number().int().positive(),
	authToken: z.string().nullable().optional(),
});
const accountSchema = z.object({
	id: z.union([z.string(), z.number()]),
	title: z.string().optional(),
	username: z.string().optional(),
});
const homeUserSchema = z.object({
	id: z.union([z.string(), z.number()]),
	title: z.string(),
	protected: z.union([z.boolean(), z.number(), z.string()]).optional(),
});
const homeUsersSchema = z.object({ users: z.array(homeUserSchema) });
const xmlParser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "",
	processEntities: false,
});
const connectionSchema = z.object({ uri: z.string().url() });
const resourceSchema = z.object({
	clientIdentifier: z.string().min(1),
	name: z.string(),
	provides: z.string(),
	owned: z.union([z.boolean(), z.number(), z.string()]).optional(),
	accessToken: z.string().min(1).nullish(),
	connections: z.array(connectionSchema).optional(),
});
const resourcesSchema = z.array(resourceSchema);
const xmlIdSchema = z.union([
	z.string().min(1),
	z.number().int().nonnegative(),
]);
const sharedServerSchema = z.object({
	userID: xmlIdSchema,
	accessToken: z.string().optional(),
	acceptedAt: xmlIdSchema.optional(),
	username: z.string().optional(),
});
const sharedServersSchema = z.object({
	MediaContainer: z.object({
		SharedServer: z
			.union([sharedServerSchema, z.array(sharedServerSchema)])
			.optional(),
	}),
});
const friendsSchema = z.object({
	MediaContainer: z.object({
		User: z
			.union([
				z.object({
					id: xmlIdSchema,
					username: z.string().optional(),
					title: z.string().optional(),
				}),
				z.array(
					z.object({
						id: xmlIdSchema,
						username: z.string().optional(),
						title: z.string().optional(),
					}),
				),
			])
			.optional(),
	}),
});
const serverIdentitySchema = z.object({
	MediaContainer: z.object({ machineIdentifier: z.string().min(1) }),
});
const sectionSchema = z.object({
	key: z.string().min(1),
	type: z.string(),
});
const sectionsSchema = z.object({
	MediaContainer: z.object({ Directory: z.array(sectionSchema).optional() }),
});
const metadataSchema = z.object({
	ratingKey: z.string().min(1),
	grandparentRatingKey: z.string().optional(),
	grandparentTitle: z.string().optional(),
	parentIndex: z.number().int().nonnegative().optional(),
	index: z.number().int().nonnegative().optional(),
	Media: z
		.array(
			z.object({
				Part: z.array(z.object({ file: z.string().optional() })).optional(),
			}),
		)
		.optional(),
	title: z.string().default(""),
	viewCount: z.number().optional(),
	Guid: z.array(z.object({ id: z.string() })).optional(),
	guid: z.string().optional(),
});
const metadataPageSchema = z.object({
	MediaContainer: z.object({
		totalSize: z.number().int().nonnegative(),
		offset: z.number().int().nonnegative().optional(),
		Metadata: z.array(metadataSchema).optional(),
	}),
});
const metadataItemSchema = z.object({
	MediaContainer: z.object({ Metadata: z.array(metadataSchema) }),
});

function plexHeaders(clientIdentifier: string, token?: string): Headers {
	const headers = new Headers({
		"X-Plex-Client-Identifier": clientIdentifier,
		"X-Plex-Product": PLEX_PRODUCT,
		"X-Plex-Version": PLEX_VERSION,
	});
	if (token) headers.set("X-Plex-Token", token);
	return headers;
}

function externalIds(
	metadata: z.infer<typeof metadataSchema>,
): MediaItem["ids"] {
	const ids: MediaItem["ids"] = [];
	for (const guid of [
		...(metadata.Guid ?? []).map((item) => item.id),
		metadata.guid ?? "",
	]) {
		const match = /^(imdb|tmdb|tvdb):\/\/([^/?#]+)(?:[?#].*)?$/i.exec(guid);
		if (!match) continue;
		const provider = match[1]?.toLowerCase();
		const value = match[2];
		if (!value) continue;
		if (provider === "imdb" || provider === "tmdb" || provider === "tvdb") {
			if (!ids.some((id) => id.provider === provider && id.value === value)) {
				ids.push({ provider, value });
			}
		}
	}
	return ids;
}

function toMediaItem(
	metadata: z.infer<typeof metadataSchema>,
	kind: MediaItem["kind"],
): MediaItem {
	const details: NonNullable<MediaItem["details"]> = {
		paths: metadata.Media?.flatMap(
			(media) =>
				media.Part?.flatMap((part) => (part.file ? [part.file] : [])) ?? [],
		),
		...(kind === "episode"
			? {
					showId: metadata.grandparentRatingKey,
					showTitle: metadata.grandparentTitle,
					season: metadata.parentIndex,
					episode: metadata.index,
				}
			: {}),
	};
	return {
		id: metadata.ratingKey,
		kind,
		title: metadata.title,
		ids: externalIds(metadata),
		...(Object.values(details).some((value) => value !== undefined)
			? { details }
			: {}),
		watched: (metadata.viewCount ?? 0) > 0,
	};
}

export function createPlexProvider(options: {
	clientIdentifier: string;
	fetch?: typeof globalThis.fetch;
	plexUrl?: string;
}): PlexProvider {
	const fetcher = options.fetch ?? globalThis.fetch;
	const plexRoot = (options.plexUrl ?? PLEX_ROOT).replace(
		/\/api(?:\/v2)?\/?$/,
		"",
	);
	const accountUrl = `${plexRoot}/api/v2`;
	const homeUrl = `${plexRoot}/api`;

	return {
		async startLogin() {
			const url = endpoint(accountUrl, "pins");
			url.searchParams.set("strong", "true");
			const pin = await requestJson({
				fetch: fetcher,
				url,
				schema: pinSchema,
				method: "POST",
				headers: plexHeaders(options.clientIdentifier),
			});
			const params = new URLSearchParams({
				clientID: options.clientIdentifier,
				code: pin.code,
				"context[device][product]": PLEX_PRODUCT,
				"context[device][version]": PLEX_VERSION,
				"context[device][platform]": PLEX_PLATFORM,
				"context[device][device]": PLEX_PLATFORM,
				"context[device][deviceName]": PLEX_PRODUCT,
			});
			return {
				id: pin.id,
				code: pin.code,
				expiresIn: pin.expiresIn,
				authorizationUrl: `https://app.plex.tv/auth/#!?${params}`,
			};
		},

		async pollLogin(pin) {
			const status = await requestJson({
				fetch: fetcher,
				url: endpoint(accountUrl, `pins/${pin.id}`),
				schema: pinSchema.partial({ expiresIn: true }),
				headers: plexHeaders(options.clientIdentifier),
			});
			if (status.id !== pin.id || status.code !== pin.code) {
				throw new MediaError(
					"The Plex login response did not match the pending PIN.",
					502,
				);
			}
			if (!status.authToken) return null;
			const account = await requestJson({
				fetch: fetcher,
				url: endpoint(accountUrl, "user"),
				schema: accountSchema,
				headers: plexHeaders(options.clientIdentifier, status.authToken),
			});
			return {
				userId: String(account.id),
				name: account.title ?? account.username ?? String(account.id),
				token: new Secret(status.authToken),
			};
		},

		async homeUsers(token) {
			const response = await requestJson({
				fetch: fetcher,
				url: endpoint(accountUrl, "home/users"),
				schema: homeUsersSchema,
				headers: plexHeaders(options.clientIdentifier, token.reveal()),
			});
			return response.users.map((user) => ({
				id: String(user.id),
				name: user.title,
				protected:
					user.protected === true ||
					user.protected === 1 ||
					user.protected === "1" ||
					user.protected === "true",
			}));
		},

		async directory({ token, owner, serverId }) {
			const [home, xml, names] = await Promise.all([
				this.homeUsers(token),
				requestText({
					fetch: fetcher,
					url: endpoint(
						homeUrl,
						`servers/${encodeURIComponent(serverId)}/shared_servers`,
					),
					headers: plexHeaders(options.clientIdentifier, token.reveal()),
				}),
				requestText({
					fetch: fetcher,
					url: endpoint(homeUrl, "users"),
					headers: plexHeaders(options.clientIdentifier, token.reveal()),
				})
					.then((response) => {
						const parsed = friendsSchema.safeParse(
							xmlParser.parse(response, true),
						);
						const friends = parsed.success
							? parsed.data.MediaContainer.User
							: undefined;
						return new Map(
							(friends === undefined
								? []
								: Array.isArray(friends)
									? friends
									: [friends]
							).map((friend) => [
								String(friend.id),
								friend.username?.trim() ||
									friend.title?.trim() ||
									`Plex user ${String(friend.id)}`,
							]),
						);
					})
					.catch(() => new Map<string, string>()),
			]);
			const grants = sharedServersSchema.parse(xmlParser.parse(xml, true))
				.MediaContainer.SharedServer;
			const users = new Map<string, PlexDirectoryUser>();
			users.set(owner.userId, {
				id: owner.userId,
				name: owner.name,
				access: { kind: "owner" },
			});
			for (const member of home) {
				if (member.id !== owner.userId)
					users.set(member.id, {
						id: member.id,
						name: member.name,
						access: { kind: "unavailable" },
					});
			}
			for (const grant of grants === undefined
				? []
				: Array.isArray(grants)
					? grants
					: [grants]) {
				const acceptedAt = Number(grant.acceptedAt);
				if (
					!Number.isFinite(acceptedAt) ||
					acceptedAt <= 0 ||
					!grant.accessToken
				)
					continue;
				const id = String(grant.userID);
				if (id === owner.userId) continue;
				users.set(id, {
					id,
					name:
						users.get(id)?.name ??
						(grant.username?.trim() || names.get(id) || `Plex user ${id}`),
					access: {
						kind: "shared_grant",
						token: new Secret(grant.accessToken),
					},
				});
			}
			return [...users.values()];
		},

		async servers(token) {
			const url = endpoint(accountUrl, "resources");
			url.searchParams.set("includeHttps", "1");
			const resources = await requestJson({
				fetch: fetcher,
				url,
				schema: resourcesSchema,
				headers: plexHeaders(options.clientIdentifier, token.reveal()),
			});
			return resources
				.filter(
					(resource) =>
						resource.provides.split(",").includes("server") &&
						(resource.owned === true ||
							resource.owned === 1 ||
							resource.owned === "1" ||
							resource.owned === "true"),
				)
				.flatMap((resource) => {
					if (!resource.accessToken || !resource.connections?.length) return [];
					return {
						id: resource.clientIdentifier,
						name: resource.name,
						token: new Secret(resource.accessToken),
						connections: resource.connections.map(
							(connection) => connection.uri,
						),
					};
				});
		},

		async verifyServer(access, serverId) {
			const response = await requestJson({
				fetch: fetcher,
				url: endpoint(access.url, "identity"),
				schema: serverIdentitySchema,
				headers: plexHeaders(options.clientIdentifier, access.token.reveal()),
			});
			if (response.MediaContainer.machineIdentifier !== serverId) {
				throw new MediaError("The URL points to a different Plex server.", 409);
			}
			await requestJson({
				fetch: fetcher,
				url: endpoint(access.url, "library/sections"),
				schema: sectionsSchema,
				headers: plexHeaders(options.clientIdentifier, access.token.reveal()),
			});
		},

		async items(access) {
			const headers = plexHeaders(
				options.clientIdentifier,
				access.token.reveal(),
			);
			const sections = await requestJson({
				fetch: fetcher,
				url: endpoint(access.url, "library/sections"),
				schema: sectionsSchema,
				headers,
			});
			const items: MediaItem[] = [];
			const seen = new Set<string>();
			for (const section of sections.MediaContainer.Directory ?? []) {
				const kind =
					section.type === "movie"
						? "movie"
						: section.type === "show"
							? "episode"
							: null;
				if (!kind) continue;
				if (!/^\d+$/.test(section.key))
					throw new MediaError(
						"Plex returned an invalid library section.",
						502,
					);
				let offset = 0;
				let total: number | undefined;
				do {
					const url = endpoint(
						access.url,
						`library/sections/${section.key}/all`,
					);
					url.searchParams.set("type", kind === "movie" ? "1" : "4");
					url.searchParams.set("includeGuids", "1");
					const pageHeaders = new Headers(headers);
					pageHeaders.set("X-Plex-Container-Start", String(offset));
					pageHeaders.set("X-Plex-Container-Size", String(PAGE_SIZE));
					const page = (
						await requestJson({
							fetch: fetcher,
							url,
							schema: metadataPageSchema,
							headers: pageHeaders,
						})
					).MediaContainer;
					const entries = page.Metadata ?? [];
					if (total === undefined) total = page.totalSize;
					if (
						page.totalSize !== total ||
						(page.offset !== undefined && page.offset !== offset) ||
						entries.length > PAGE_SIZE ||
						(entries.length === 0 && offset < total)
					) {
						throw new MediaError(
							"Plex returned an incomplete library page.",
							502,
						);
					}
					for (const entry of entries) {
						if (seen.has(entry.ratingKey))
							throw new MediaError("Plex returned a duplicate item.", 502);
						seen.add(entry.ratingKey);
						items.push(toMediaItem(entry, kind));
					}
					offset += entries.length;
					if (offset > total || (offset < total && entries.length < PAGE_SIZE))
						throw new MediaError(
							"Plex returned an incomplete library page.",
							502,
						);
				} while (offset < total);
			}
			return items;
		},

		async markWatched(access: MediaAccess, itemId: string) {
			if (!/^\d+$/.test(itemId)) throw new MediaError("Invalid Plex item ID.");
			const headers = plexHeaders(
				options.clientIdentifier,
				access.token.reveal(),
			);
			const response = await requestJson({
				fetch: fetcher,
				url: endpoint(access.url, `library/metadata/${itemId}`),
				schema: metadataItemSchema,
				headers,
			});
			const [item] = response.MediaContainer.Metadata;
			if (!item || item.ratingKey !== itemId)
				throw new MediaError("Plex item was not found.", 404);
			if ((item.viewCount ?? 0) > 0) return;
			const url = endpoint(access.url, ":/scrobble");
			url.searchParams.set("key", itemId);
			url.searchParams.set("identifier", LIBRARY_IDENTIFIER);
			await requestEmpty({ fetch: fetcher, url, method: "PUT", headers });
		},
	};
}
