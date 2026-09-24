import { createApi } from "~/backend/api";
import { getMediaService } from "~/backend/media/runtime.server";
export const api = createApi(undefined, getMediaService);
