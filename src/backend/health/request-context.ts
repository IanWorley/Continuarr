import { Context, Effect, Layer } from "effect";

const REQUEST_CONTEXT_TAG_ID = "continuarr/health/RequestContext";
const REQUEST_ID_GENERATOR_TAG_ID = "continuarr/health/RequestIdGenerator";

export type CreateRequestId = () => string;

export interface RequestIdGenerator {
	readonly createRequestId: CreateRequestId;
}

export const RequestIdGenerator = Context.GenericTag<RequestIdGenerator>(
	REQUEST_ID_GENERATOR_TAG_ID,
);

export interface RequestContext {
	readonly requestId: string;
}

export const RequestContext = Context.GenericTag<RequestContext>(
	REQUEST_CONTEXT_TAG_ID,
);

export const requestContextLive = Layer.effect(
	RequestContext,
	Effect.flatMap(RequestIdGenerator, ({ createRequestId }) =>
		Effect.sync(() => ({ requestId: createRequestId() })),
	),
);
