import Elysia from "elysia";
import { startPlexLogin } from "~/backend/auth/plex/service";

export const plexRoutes = new Elysia().get("/plex/login/start", startPlexLogin);
