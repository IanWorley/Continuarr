import Elysia from "elysia";

export const plexRoutes = new Elysia().get("/auth/plex/login", () => ({
	clientIdentifier: crypto.randomUUID(),
}));
