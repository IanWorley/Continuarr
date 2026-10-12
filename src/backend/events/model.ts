import { z } from "zod";

export const QUEUE_STATUSES = [
	"pending",
	"processing",
	"completed",
	"failed",
] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

const mediaServiceSchema = z.enum(["plex", "jellyfin"]);
const episodeWatchedState = {
	serverId: z.string().min(1),
	userId: z.string().min(1),
	itemId: z.string().min(1),
	watched: z.boolean(),
};

export const inboxEventSchema = z.strictObject({
	source: mediaServiceSchema,
	...episodeWatchedState,
	occurredAt: z.iso.datetime().nullable(),
});
export type InboxEvent = z.infer<typeof inboxEventSchema>;

export const outboxDeliverySchema = z.strictObject({
	target: mediaServiceSchema,
	...episodeWatchedState,
});
export type OutboxDelivery = z.infer<typeof outboxDeliverySchema>;

export type QueuePayload<TPayload> = {
	version: number;
	schema: z.ZodType<TPayload>;
};
export const INBOX_EVENT_PAYLOAD = {
	version: 1,
	schema: inboxEventSchema,
} satisfies QueuePayload<InboxEvent>;
export const OUTBOX_DELIVERY_PAYLOAD = {
	version: 1,
	schema: outboxDeliverySchema,
} satisfies QueuePayload<OutboxDelivery>;
