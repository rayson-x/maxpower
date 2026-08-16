import * as SecureStore from "expo-secure-store";

import {
  SecureCredentialError,
  type SecureCredentialKey,
  type SecureCredentialPort,
  type SecureCredentialReadResult,
} from "../../privacy";
import { secureCredentialStorageKey } from "../security/credentialNamespace";

/**
 * Android Keystore / iOS Keychain adapter supplied by Expo SecureStore. Values
 * use stable hashed keys so account IDs and credential names are not retained
 * as clear-text key labels. Secrets are device-only and excluded from backups.
 */
export function createExpoSecureCredentialPort(): SecureCredentialPort {
  const isAvailable = async (): Promise<void> => {
    if (!await SecureStore.isAvailableAsync()) throw new SecureCredentialError("unavailable");
  };
  const optionsFor = (key: SecureCredentialKey, requireUserPresence?: boolean): SecureStore.SecureStoreOptions => ({
    keychainService: `com.maxpower.secure.${key.scope}${requireUserPresence ? ".presence" : ""}`,
    requireAuthentication: requireUserPresence === true,
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  const encodedValue = (key: SecureCredentialKey, value: string) => JSON.stringify({
    version: 2,
    accountId: key.accountId,
    scope: key.scope,
    name: key.name,
    value,
  });
  const decodedValue = (key: SecureCredentialKey, value: string): string | null => {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return parsed.version === 2 &&
        parsed.accountId === key.accountId &&
        parsed.scope === key.scope &&
        parsed.name === key.name &&
        typeof parsed.value === "string" && parsed.value.length > 0
        ? parsed.value
        : null;
    } catch {
      return null;
    }
  };
  const mapReadError = (): SecureCredentialReadResult => ({ status: "unavailable" });

  return {
    async put(input) {
      await isAvailable();
      if (!input.value) throw new SecureCredentialError("write_failed");
      try {
        await SecureStore.setItemAsync(
          secureCredentialStorageKey(input.key),
          encodedValue(input.key, input.value),
          optionsFor(input.key, input.requireUserPresence),
        );
      } catch {
        throw new SecureCredentialError("write_failed");
      }
    },
    async get(input) {
      try {
        await isAvailable();
        const options = optionsFor(input.key, input.requireUserPresence);
        const value = await SecureStore.getItemAsync(secureCredentialStorageKey(input.key), options);
        // SecureStore reports both deleted and invalidated biometric entries as null.
        if (value !== null) {
          const decoded = decodedValue(input.key, value);
          return decoded === null
            ? { status: "missing_or_invalidated" }
            : { status: "available", value: decoded };
        }
        return { status: "missing_or_invalidated" };
      } catch {
        return mapReadError();
      }
    },
    async delete(input) {
      await isAvailable();
      try {
        await SecureStore.deleteItemAsync(secureCredentialStorageKey(input.key), optionsFor(input.key, input.requireUserPresence));
      } catch {
        throw new SecureCredentialError("delete_failed");
      }
    },
    async rotate(input) {
      await isAvailable();
      if (!input.value) throw new SecureCredentialError("write_failed");
      try {
        const options = optionsFor(input.key, input.requireUserPresence);
        await SecureStore.setItemAsync(
          secureCredentialStorageKey(input.key),
          encodedValue(input.key, input.value),
          options,
        );
      } catch {
        throw new SecureCredentialError("write_failed");
      }
    },
  };
}
