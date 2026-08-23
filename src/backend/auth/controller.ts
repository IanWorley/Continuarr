import { Elysia } from "elysia";
import { AUTH_PREFIX } from "~/backend/auth/plex/endpoints";
import { plexRoutes } from "~/backend/auth/plex/controller";

export const authRoutes = new Elysia({ prefix: AUTH_PREFIX }).use(plexRoutes);
