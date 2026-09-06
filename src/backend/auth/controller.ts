import { Elysia } from "elysia";
import { jellyfinRoutes } from "~/backend/auth/jellyfin/controller";
import { plexRoutes } from "~/backend/auth/plex/controller";

export const authRoutes = new Elysia({ prefix: "/auth" })
	.use(plexRoutes)
	.use(jellyfinRoutes);
