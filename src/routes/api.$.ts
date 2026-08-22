import { treaty } from "@elysia/eden";
import { createFileRoute } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";

import { api } from "~/backend/api";

const handleRequest = ({ request }: { request: Request }) => api.fetch(request);

export const Route = createFileRoute("/api/$")({
	server: {
		handlers: {
			GET: handleRequest,
		},
	},
});

export const getApi = createIsomorphicFn()
	.server(() => treaty(api).api)
	.client(() => treaty<typeof api>(window.location.origin).api);
