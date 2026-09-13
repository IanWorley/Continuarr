import {
	createStartHandler,
	defaultStreamHandler,
} from "@tanstack/react-start/server";
import "~/backend/secrets/storage.server";

export default { fetch: createStartHandler(defaultStreamHandler) };
