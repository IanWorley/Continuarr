/// <reference types="bun" />

import { beforeEach, describe, expect, it } from "bun:test";
import type { InboxEvent, OutboxDelivery } from "~/backend/events/model";
import { createDeliveryOutbox, createEventInbox } from "~/backend/events/repo";
import type { AppDatabase } from "~/db/database";
import { eventInbox } from "~/db/schema";
import { setupTestDatabase } from "~/db/test-database";

const createTestDatabase = setupTestDatabase();
const EVENT_KEY = "plex:webhook:event-1";
const SECOND_EVENT_KEY = "plex:webhook:event-2";
const LEASE_MS = 60_000;
const EXPIRED_LEASE_MS = 0;
const IMMEDIATE_RETRY_MS = 0;
const LATER_RETRY_MS = 60_000;
const CONCURRENT_WORKERS = 5;
const CONCURRENT_RECORDS = 50;
const UNSUPPORTED_PAYLOAD_VERSION = 2;
const PLEX_TIMEOUT = "Plex timed out";
const JELLYFIN_TIMEOUT = "Jellyfin timed out";
const UNMATCHED_EPISODE = "Episode is not matched";
const LATE_FAILURE = "Late failure";
const WATCHED_EVENT: InboxEvent = {
	source: "plex",
	serverId: "plex-server",
	userId: "plex-user",
	itemId: "episode-1",
	watched: true,
	occurredAt: "2026-10-11T12:00:00.000Z",
};
const UNWATCHED_EVENT: InboxEvent = { ...WATCHED_EVENT, watched: false };
const DELIVERY: OutboxDelivery = {
	target: "jellyfin",
	serverId: "jellyfin-server",
	userId: "jellyfin-user",
	itemId: "jellyfin-episode-1",
	watched: true,
};

let db: AppDatabase;
let inbox: ReturnType<typeof createEventInbox>;

beforeEach(async () => {
	({ db } = await createTestDatabase());
	inbox = createEventInbox(() => db);
});

async function claimNext(leaseMs = LEASE_MS) {
	const claim = await inbox.claim(leaseMs);
	if (!claim) throw new Error("Expected a claimable inbox record.");
	return claim;
}

async function storedRecords() {
	return await db
		.select({
			status: eventInbox.status,
			attempts: eventInbox.attempts,
			lastError: eventInbox.lastError,
		})
		.from(eventInbox)
		.orderBy(eventInbox.id);
}

describe("event inbox", () => {
	it("keeps the first event when a duplicate arrives with the same idempotency key", async () => {
		expect(await inbox.enqueue(EVENT_KEY, WATCHED_EVENT)).toBe("enqueued");
		expect(await inbox.enqueue(EVENT_KEY, UNWATCHED_EVENT)).toBe("duplicate");

		expect(await inbox.claim(LEASE_MS)).toEqual({
			id: expect.any(Number),
			attempt: 1,
			payload: WATCHED_EVENT,
		});
		expect(await inbox.claim(LEASE_MS)).toBeNull();
	});

	it("rejects fields outside the normalized event", async () => {
		const upstreamPayload = { ...WATCHED_EVENT, token: "plex-token" };

		await expect(
			inbox.enqueue(EVENT_KEY, upstreamPayload as InboxEvent),
		).rejects.toMatchObject({
			issues: [{ code: "unrecognized_keys", keys: ["token"] }],
		});
		expect(await storedRecords()).toEqual([]);
	});

	it("gives each record to exactly one of several concurrent workers", async () => {
		const keys = Array.from(
			{ length: CONCURRENT_RECORDS },
			(_, index) => `plex:webhook:race-${index}`,
		);
		for (const key of keys) await inbox.enqueue(key, WATCHED_EVENT);

		async function drain() {
			const attempts: number[] = [];
			let claim = await inbox.claim(LEASE_MS);
			while (claim) {
				attempts.push(claim.attempt);
				claim = await inbox.claim(LEASE_MS);
			}
			return attempts;
		}
		const claimed = await Promise.all(
			Array.from({ length: CONCURRENT_WORKERS }, drain),
		);

		expect(claimed.flat()).toEqual(keys.map(() => 1));
	});

	it("does not offer a completed record again", async () => {
		await inbox.enqueue(EVENT_KEY, WATCHED_EVENT);

		expect(await inbox.complete(await claimNext())).toBe(true);

		expect(await inbox.claim(EXPIRED_LEASE_MS)).toBeNull();
		expect(await storedRecords()).toEqual([
			{ status: "completed", attempts: 1, lastError: null },
		]);
	});

	it("offers a retried record again only after its delay", async () => {
		await inbox.enqueue(EVENT_KEY, WATCHED_EVENT);
		await inbox.enqueue(SECOND_EVENT_KEY, UNWATCHED_EVENT);
		const delayed = await claimNext();
		const immediate = await claimNext();

		expect(await inbox.retry(delayed, PLEX_TIMEOUT, LATER_RETRY_MS)).toBe(true);
		expect(
			await inbox.retry(immediate, JELLYFIN_TIMEOUT, IMMEDIATE_RETRY_MS),
		).toBe(true);

		expect(await inbox.claim(LEASE_MS)).toEqual({
			id: immediate.id,
			attempt: 2,
			payload: UNWATCHED_EVENT,
		});
		expect(await inbox.claim(LEASE_MS)).toBeNull();
		expect(await storedRecords()).toEqual([
			{ status: "pending", attempts: 1, lastError: PLEX_TIMEOUT },
			{ status: "processing", attempts: 2, lastError: JELLYFIN_TIMEOUT },
		]);
	});

	it("stops offering a record after a permanent failure", async () => {
		await inbox.enqueue(EVENT_KEY, WATCHED_EVENT);

		expect(await inbox.fail(await claimNext(), UNMATCHED_EPISODE)).toBe(true);

		expect(await inbox.claim(EXPIRED_LEASE_MS)).toBeNull();
		expect(await storedRecords()).toEqual([
			{ status: "failed", attempts: 1, lastError: UNMATCHED_EPISODE },
		]);
	});

	it("reclaims a record after the worker that held it stops renewing its lease", async () => {
		await inbox.enqueue(EVENT_KEY, WATCHED_EVENT);
		const crashed = await claimNext(EXPIRED_LEASE_MS);

		expect(await inbox.claim(LEASE_MS)).toEqual({
			id: crashed.id,
			attempt: 2,
			payload: WATCHED_EVENT,
		});
	});

	it("ignores a result from a worker whose lease was taken over", async () => {
		await inbox.enqueue(EVENT_KEY, WATCHED_EVENT);
		const stale = await claimNext(EXPIRED_LEASE_MS);
		const current = await claimNext();

		expect(await inbox.fail(stale, LATE_FAILURE)).toBe(false);
		expect(await inbox.complete(current)).toBe(true);
		expect(await storedRecords()).toEqual([
			{ status: "completed", attempts: 2, lastError: null },
		]);
	});

	it("leaves a record with an unsupported payload version unclaimed", async () => {
		await db.insert(eventInbox).values({
			idempotencyKey: SECOND_EVENT_KEY,
			payloadVersion: UNSUPPORTED_PAYLOAD_VERSION,
			payload: UNWATCHED_EVENT,
		});
		await inbox.enqueue(EVENT_KEY, WATCHED_EVENT);

		expect((await claimNext()).payload).toEqual(WATCHED_EVENT);
		expect(await inbox.claim(LEASE_MS)).toBeNull();
	});
});

describe("delivery outbox", () => {
	it("claims a queued delivery with its normalized payload", async () => {
		const outbox = createDeliveryOutbox(() => db);

		expect(await outbox.enqueue(EVENT_KEY, DELIVERY)).toBe("enqueued");

		expect(await outbox.claim(LEASE_MS)).toEqual({
			id: expect.any(Number),
			attempt: 1,
			payload: DELIVERY,
		});
	});
});
