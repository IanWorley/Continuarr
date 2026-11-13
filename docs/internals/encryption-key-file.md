# Generated encryption key

When `CONTINUARR_ENCRYPTION_KEY` is blank, [`EncryptionKeyFileEnvironmentPostProcessor`](../../backend/src/main/kotlin/xyz/ianworley/continuarr/security/encryptionkey/EncryptionKeyFileEnvironmentPostProcessor.kt) supplies `continuarr.encryption-key` from a file in `CONTINUARR_DATA_DIR`. It runs before any bean binds the property, so the code that encrypts secrets never knows where its key came from. Keep it that way. A consumer that reads the key some other way, before the environment is ready, would miss it.

## Why a new key is pending first

The post-processor runs before the database is reachable, so it can't tell a fresh install from one that lost its key file. It writes a new key to `encryption.key.pending`. [`PendingEncryptionKeyCheck`](../../backend/src/main/kotlin/xyz/ianworley/continuarr/security/encryptionkey/PendingEncryptionKeyCheck.kt) then runs once every bean exists, which is after Liquibase and before the web server or any `ApplicationRunner`. It commits the key to `encryption.key` only when no saved secret exists. Otherwise startup fails, and the pending key is never committed, so a crash or a retry can't turn it into the install's key.

So a startup task that saves a secret must run as an `ApplicationRunner` or on `ApplicationReadyEvent`, never while its bean is created. A secret saved during bean creation lands before the check, under the pending key, and every later start then refuses that key. The check uses JPA, so it can't be ordered as a database initializer: the `EntityManagerFactory` would then depend on it, and it on the factory.

Files are only created, with a hard link from a complete temporary file, never renamed over. Two instances that start at once on one data directory end up on whichever key was linked first.

## Name every encrypted column `*_ciphertext`

The check finds saved secrets by looking for rows with a non-null value in any column whose name ends in `_ciphertext`. A secret stored in a column named any other way is invisible to it, and a lost key file would then get a new key that can't read that secret.
