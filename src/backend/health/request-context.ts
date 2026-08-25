export type CreateRequestId = () => string;

interface RequestContextDependencies {
	createRequestId: CreateRequestId;
}

export interface RequestContext {
	requestId: string;
}

export function createRequestContext({
	createRequestId,
}: RequestContextDependencies): RequestContext {
	return { requestId: createRequestId() };
}
