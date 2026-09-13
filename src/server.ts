import {
	createStartHandler,
	defaultStreamHandler,
} from "@tanstack/react-start/server";
import "~/backend/secrets/storage.server";

import { administratorService } from "~/backend/admin/service";

administratorService.initializeSetup();

export default { fetch: createStartHandler(defaultStreamHandler) };
