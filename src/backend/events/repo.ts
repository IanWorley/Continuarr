import { and, eq, inArray, lte, type SQL, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import {
	INBOX_EVENT_PAYLOAD,
	OUTBOX_DELIVERY_PAYLOAD,
	type QueuePayload,
	type QueueStatus,
} from "~/backend/events/model";
import { type AppDatabase, getDatabase } from "~/db/database";
import {
	type DurableQueueTable,
	deliveryOutbox,
	eventInbox,
} from "~/db/schema";

// A processing record is claimable again once its lease expires, which recovers work from a crashed worker.
const CLAIMABLE_STATUSES: QueueStatus[] = ["pending", "processing"];

export type QueueClaim<TPayload> = {
	id: number;
	attempt: number;
	payload: TPayload;
};
export type EnqueueResult = "enqueued" | "duplicate";

function millisecondsFromNow(milliseconds: number): SQL<Date> {
	return sql<Date>`now() + ${milliseconds} * interval '1 millisecond'`;
}

export function createDurableQueue<TPayload>(
	table: DurableQueueTable<TPayload>,
	payload: QueuePayload<TPayload>,
	database: () => AppDatabase = () => getDatabase().db,
) {
	// Every claim increments attempts, so matching it rejects a late result from a worker whose lease was taken over.
	async function settle(
		claim: QueueClaim<TPayload>,
		changes: PgUpdateSetSource<DurableQueueTable<TPayload>>,
	): Promise<boolean> {
		const settled = await database()
			.update(table)
			.set(changes)
			.where(
				and(
					eq(table.id, claim.id),
					eq(table.attempts, claim.attempt),
					eq(table.status, "processing"),
				),
			)
			.returning({ id: table.id });
		return settled.length > 0;
	}

	return {
		async enqueue(
			idempotencyKey: string,
			value: TPayload,
		): Promise<EnqueueResult> {
			const [created] = await database()
				.insert(table)
				.values({
					idempotencyKey,
					payloadVersion: payload.version,
					payload: payload.schema.parse(value),
				})
				.onConflictDoNothing({ target: table.idempotencyKey })
				.returning({ id: table.id });
			return created ? "enqueued" : "duplicate";
		},

		async claim(leaseMs: number): Promise<QueueClaim<TPayload> | null> {
			// Records written with another payload version stay queued for a build that can read them.
			const next = database()
				.select({ id: table.id })
				.from(table)
				.where(
					and(
						inArray(table.status, CLAIMABLE_STATUSES),
						lte(table.nextAttemptAt, sql`now()`),
						eq(table.payloadVersion, payload.version),
					),
				)
				.orderBy(table.id)
				.limit(1)
				.for("update", { skipLocked: true });
			const [claimed] = await database()
				.update(table)
				.set({
					status: "processing",
					attempts: sql`${table.attempts} + 1`,
					nextAttemptAt: millisecondsFromNow(leaseMs),
				})
				.where(inArray(table.id, next))
				.returning();
			if (!claimed) return null;
			return {
				id: claimed.id,
				attempt: claimed.attempts,
				payload: payload.schema.parse(claimed.payload),
			};
		},

		complete: (claim: QueueClaim<TPayload>) =>
			settle(claim, { status: "completed" }),

		retry: (claim: QueueClaim<TPayload>, error: string, delayMs: number) =>
			settle(claim, {
				status: "pending",
				lastError: error,
				nextAttemptAt: millisecondsFromNow(delayMs),
			}),

		fail: (claim: QueueClaim<TPayload>, error: string) =>
			settle(claim, { status: "failed", lastError: error }),
	};
}

export function createEventInbox(database?: () => AppDatabase) {
	return createDurableQueue(eventInbox, INBOX_EVENT_PAYLOAD, database);
}

export function createDeliveryOutbox(database?: () => AppDatabase) {
	return createDurableQueue(deliveryOutbox, OUTBOX_DELIVERY_PAYLOAD, database);
}
