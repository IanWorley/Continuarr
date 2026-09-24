import {
	createStartHandler,
	defaultStreamHandler,
} from "@tanstack/react-start/server";
import "~/backend/secrets/storage.server";

import { startMediaScheduler } from "~/backend/media/runtime.server";

const handle = createStartHandler(defaultStreamHandler);
export default {
	async fetch(request: Request) {
		await startMediaScheduler().catch(() => {
			console.error(
				"Automatic sync scheduler could not start. It will retry on the next request.",
			);
		});
		return handle(request);
	},
};
