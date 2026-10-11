const CLIENT_NAME = "Continuarr";
const CLIENT_VERSION = "1.0.0";
const DEVICE_NAME = "server";

export function jellyfinHeaders(
	clientIdentifier: string,
	token?: string,
): Headers {
	return new Headers({
		Authorization: `MediaBrowser Client="${CLIENT_NAME}", Device="${DEVICE_NAME}", DeviceId="${clientIdentifier}", Version="${CLIENT_VERSION}"${token ? `, Token="${token}"` : ""}`,
	});
}
