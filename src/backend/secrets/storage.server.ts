import { createSecretStorage } from "~/backend/secrets/storage";

// Validate deployment configuration as the server API initializes.
export const secretStorage = createSecretStorage();
