import { Elysia } from "elysia";
import { plexRoutes } from "~/backend/auth/plex/controller";
import { AUTH_PREFIX } from "~/backend/auth/plex/endpoints";

export const authRoutes = new Elysia({ prefix: AUTH_PREFIX }).use(plexRoutes);
