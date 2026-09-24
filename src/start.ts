import { createMiddleware, createStart } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";

const requireAdministrator = createMiddleware().server(
	async ({ request, next }) => {
		const { guardRequest } = await import("~/backend/admin/guard");
		setResponseHeader("Cache-Control", "no-store");
		const rejection = await guardRequest(request);
		return rejection ?? next();
	},
);

export const startInstance = createStart(() => ({
	requestMiddleware: [requireAdministrator],
}));
