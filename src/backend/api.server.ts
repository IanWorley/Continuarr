import { createApi } from "~/backend/api";
import { createBackendContainer } from "~/backend/container";

export const backendContainer = createBackendContainer();

export const api = createApi({
	startPlexLogin: backendContainer.get("startPlexLogin"),
});

export function disposeBackendResources() {
	return backendContainer.disposeAll();
}
