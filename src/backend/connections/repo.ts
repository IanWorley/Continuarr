import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { z } from "zod";
import { type createSecretStorage, Secret } from "~/backend/secrets/storage";
import { getDatabase } from "~/db/database";
import type * as schema from "~/db/schema";
import {
	CONNECTION_SERVICES,
	CONNECTION_STATUSES,
	serverConnections,
} from "~/db/schema";

const OWNER_ID = 1;
type Database = BaseSQLiteDatabase<"sync", unknown, typeof schema>;
type SecretStorage = ReturnType<typeof createSecretStorage>;
export type ConnectionService = (typeof CONNECTION_SERVICES)[number];
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

const connectionInput = z.object({
	service: z.enum(CONNECTION_SERVICES),
	serverId: z.string().trim().min(1),
	url: z.string(),
	displayName: z.string().trim().min(1),
	credential: z.instanceof(Secret),
});
export type SaveConnection = z.infer<typeof connectionInput>;

// Explicit projection keeps even ciphertext out of metadata and response models.
const metadata = {
	id: serverConnections.id,
	service: serverConnections.service,
	serverId: serverConnections.serverId,
	url: serverConnections.url,
	displayName: serverConnections.displayName,
	status: serverConnections.status,
	createdAt: serverConnections.createdAt,
	updatedAt: serverConnections.updatedAt,
};

export function normalizeServerUrl(value: string): string {
	try {
		const url = new URL(value);
		if (
			!["http:", "https:"].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		) {
			throw new Error();
		}
		url.pathname = url.pathname.replace(/\/+$/, "");
		return url.toString().replace(/\/$/, "");
	} catch {
		throw new Error(
			"Server URL must be HTTP(S) without credentials, query parameters, or fragments",
		);
	}
}

export function createConnectionRepository(
	storage: SecretStorage,
	database: () => Database = () => getDatabase().db,
) {
	return {
		list() {
			return database().select(metadata).from(serverConnections).all();
		},
		find(service: ConnectionService) {
			return (
				database()
					.select(metadata)
					.from(serverConnections)
					.where(eq(serverConnections.service, service))
					.get() ?? null
			);
		},
		save(input: SaveConnection) {
			// Avoid validation errors retaining credential-bearing input.
			const parsed = connectionInput.safeParse(input);
			if (!parsed.success) throw new Error("Invalid connection details");
			const { service, serverId, displayName, credential } = parsed.data;
			const url = normalizeServerUrl(parsed.data.url);
			return database().transaction(
				(tx) => {
					const existing = tx
						.select(metadata)
						.from(serverConnections)
						.where(eq(serverConnections.service, service))
						.get();
					if (existing && existing.serverId !== serverId) {
						throw new Error(
							"Remove the existing connection before selecting a different server",
						);
					}
					const id = existing?.id ?? randomUUID();
					const values = {
						url,
						displayName,
						encryptedCredential: storage.encrypt(id, credential),
						status: "connected" as const,
					};
					if (existing) {
						return tx
							.update(serverConnections)
							.set(values)
							.where(eq(serverConnections.id, id))
							.returning(metadata)
							.get();
					}
					return tx
						.insert(serverConnections)
						.values({
							...values,
							id,
							administratorId: OWNER_ID,
							service,
							serverId,
						})
						.returning(metadata)
						.get();
				},
				{ behavior: "immediate" },
			);
		},
		setStatus(service: ConnectionService, status: ConnectionStatus) {
			const parsed = z.enum(CONNECTION_STATUSES).safeParse(status);
			if (!parsed.success) throw new Error("Invalid connection status");
			return (
				database()
					.update(serverConnections)
					.set({ status: parsed.data })
					.where(eq(serverConnections.service, service))
					.returning(metadata)
					.get() ?? null
			);
		},
		remove(service: ConnectionService) {
			return (
				database()
					.delete(serverConnections)
					.where(eq(serverConnections.service, service))
					.returning({ id: serverConnections.id })
					.get() !== undefined
			);
		},
		// Server-side callers reveal the Secret only at the media-server client boundary.
		readCredential(service: ConnectionService): Secret | null {
			const row = database()
				.select({
					id: serverConnections.id,
					encryptedCredential: serverConnections.encryptedCredential,
				})
				.from(serverConnections)
				.where(eq(serverConnections.service, service))
				.get();
			return row ? storage.decrypt(row.id, row.encryptedCredential) : null;
		},
	};
}
export type ConnectionMetadata = ReturnType<
	ReturnType<typeof createConnectionRepository>["list"]
>[number];
