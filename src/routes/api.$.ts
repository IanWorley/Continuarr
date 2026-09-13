import { treaty } from "@elysia/eden";
import { createFileRoute } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import type { Api } from "~/backend/api";
import { api } from "~/backend/api.server";

const handleRequest = ({ request }: { request: Request }) => api.fetch(request);

export const Route = createFileRoute("/api/$")({
	server: {
		handlers: {
			GET: handleRequest,
			POST: handleRequest,
			PUT: handleRequest,
			DELETE: handleRequest,
			PATCH: handleRequest,
			OPTIONS: handleRequest,
			HEAD: handleRequest,
			TRACE: handleRequest,
			CONNECT: handleRequest,
		},
	},
});

export const getApi = createIsomorphicFn()
	.server(() => treaty(api, { headers: getRequestHeaders() }).api)
	.client(() => treaty<Api>(window.location.origin).api);
