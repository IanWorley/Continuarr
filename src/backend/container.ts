import { createContainer } from "iti";
import {
	createStartPlexLogin,
	type PlexAuthStartResult,
} from "~/backend/auth/plex/service";
import { startPlexAuth as startPlexAuthWithPlex } from "~/backend/shared/clients/plexclient";
import {
	type ApplicationSettingsRepository,
	createApplicationSettingsRepository,
} from "~/backend/shared/repo";
import { createDatabase } from "~/db/database";

type PlexAuthStarter = (
	clientIdentifier: string,
) => Promise<PlexAuthStartResult>;

export interface BackendDatabaseResource {
	applicationSettingsRepository: ApplicationSettingsRepository;
	close: () => void;
}

export interface BackendContainerOptions {
	createDatabaseResource?: () => BackendDatabaseResource;
	createClientIdentifier?: () => string;
	startPlexAuth?: PlexAuthStarter;
}

const createProductionClientIdentifier = () => crypto.randomUUID();

function createProductionDatabaseResource(): BackendDatabaseResource {
	const connection = createDatabase();
	return {
		applicationSettingsRepository:
			createApplicationSettingsRepository(connection),
		close: () => connection.client.close(),
	};
}

export function createBackendContainer(options: BackendContainerOptions = {}) {
	const createDatabaseResource =
		options.createDatabaseResource ?? createProductionDatabaseResource;
	const createClientIdentifier =
		options.createClientIdentifier ?? createProductionClientIdentifier;
	const startPlexAuth = options.startPlexAuth ?? startPlexAuthWithPlex;

	return createContainer()
		.add({
			databaseResource: createDatabaseResource,
			createClientIdentifier: () => createClientIdentifier,
			startPlexAuth: () => startPlexAuth,
		})
		.add((items) => ({
			applicationSettingsRepository: () =>
				items.databaseResource.applicationSettingsRepository,
		}))
		.add((items) => ({
			startPlexLogin: () =>
				createStartPlexLogin({
					...items.applicationSettingsRepository,
					createClientIdentifier: items.createClientIdentifier,
					startPlexAuth: items.startPlexAuth,
				}),
		}))
		.addDisposer({
			databaseResource: (resource) => resource.close(),
		});
}
