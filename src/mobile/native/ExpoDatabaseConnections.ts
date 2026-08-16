export interface ExpoDatabaseOpenOptions {
  useNewConnection?: boolean;
}

export type ExpoDatabaseOpener<TDatabase> = (
  databaseName: string,
  options?: ExpoDatabaseOpenOptions,
) => Promise<TDatabase>;

/**
 * Expo caches connections by database name unless useNewConnection is set.
 * Every persistence owner must receive a distinct native handle so closing a
 * foreground or background owner cannot invalidate another owner's handle.
 */
export function openIsolatedDatabaseConnection<TDatabase>(
  databaseName: string,
  open: ExpoDatabaseOpener<TDatabase>,
): Promise<TDatabase> {
  return open(databaseName, { useNewConnection: true });
}
