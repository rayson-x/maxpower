import { Directory, File, Paths } from "expo-file-system";

import {
  FileBackedMediaBlobStore,
  type MediaFileStoragePort,
  type MediaBlobReference,
} from "../../privacy";

export interface ExpoMediaBlobStoreOptions {
  /** Defaults to the app-private documents directory on both Android and iOS. */
  directory?: Directory;
  now?: () => string;
}

/**
 * Shared Android/iOS local-media adapter. App-level replicas never receive
 * bytes from this store; the `local_only` scope describes MaxPower sync, not
 * an operating system backup promise.
 */
export function createExpoMediaBlobStore(options: ExpoMediaBlobStoreOptions = {}) {
  const directory = options.directory ?? new Directory(Paths.document, "maxpower-media");
  return new FileBackedMediaBlobStore({
    storage: expoFileStorage(directory),
    root: "v1",
    now: options.now,
    // Files remain in the app-private sandbox. This state is intentionally
    // narrower than a claim of application-level encrypted media containers.
    encryption: "platform_protected",
  });
}

function expoFileStorage(root: Directory): MediaFileStoragePort {
  const fileFor = (path: string) => new File(root, ...path.split("/"));
  return {
    async read(path) {
      const file = fileFor(path);
      return file.exists ? file.bytes() : null;
    },
    async writeAtomically(path, bytes) {
      const destination = fileFor(path);
      destination.parentDirectory.create({ intermediates: true, idempotent: true });
      const temporary = new File(
        destination.parentDirectory,
        `.${destination.name}.${Date.now().toString(36)}.tmp`,
      );
      try {
        temporary.create({ intermediates: true, overwrite: true });
        temporary.write(bytes);
        await temporary.move(destination, { overwrite: true });
      } catch (error) {
        if (temporary.exists) {
          try {
            temporary.delete();
          } catch {
            // The next successful write can replace a stale temporary file.
          }
        }
        throw error;
      }
    },
    async remove(path) {
      const file = fileFor(path);
      if (file.exists) file.delete();
    },
  };
}

/** Retains the native adapter's public contract in generated API documentation. */
export type ExpoMediaReference = MediaBlobReference;
