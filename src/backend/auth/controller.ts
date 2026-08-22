import { Elysia } from "elysia";
import { plexRoutes } from "~/backend/auth/plex/controller";

export const authRoutes = new Elysia({ prefix: "/auth" }).use(plexRoutes);
