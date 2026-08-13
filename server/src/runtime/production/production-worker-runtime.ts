import { S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";

import { PostgresAccountDeletionAdapter } from "../../adapters/account-deletion/postgres-account-deletion.js";
import { PostgresLlmUsageAdapter } from "../../adapters/entitlements/postgres-usage.js";
import { S3MediaLibraryAdapter } from "../../adapters/object-storage/index.js";
import type { PostgresPool } from "../../adapters/postgres/client.js";
import type { ProductionWorkerConfig } from "../../config/production-config.js";
import { AccountDeletionModule, type AccountDeletion } from "../../modules/account-deletion/index.js";
import type { LlmInvocationLifecycleAdapter } from "../../modules/llm/ports.js";
import {
  PostgresIdentityEraser,
  PostgresPresignedUploadExpiryGuard,
  S3AccountMediaEraser,
} from "./deletion-erasers.js";

export interface ProductionWorkerRuntime {
  deletion: AccountDeletion;
  llmRecovery: Pick<LlmInvocationLifecycleAdapter, "recoverExpired">;
  mediaDeletion: Pick<S3MediaLibraryAdapter, "processNextDeletion">;
  close(): Promise<void>;
}

/** Connects only the durable stores required by deletion and reservation recovery. */
export async function createProductionWorkerRuntime(
  config: ProductionWorkerConfig,
): Promise<ProductionWorkerRuntime> {
  const postgres = new Pool({
    connectionString: config.database.url,
    application_name: "maxpower-deletion-worker",
    max: 5,
  });
  const objectStorage = new S3Client({
    endpoint: config.objectStorage.endpoint,
    region: config.objectStorage.region,
    forcePathStyle: config.objectStorage.forcePathStyle,
    ...(config.objectStorage.credentials
      ? { credentials: config.objectStorage.credentials }
      : {}),
  });
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await postgres.end();
    objectStorage.destroy();
  };
  try {
    await postgres.query("SELECT 1");
    const deletion = new AccountDeletionModule({
      adapter: new PostgresAccountDeletionAdapter({
        pool: postgres,
        media: new S3AccountMediaEraser({
          bucket: config.objectStorage.bucket,
          client: {
            send(command) {
              return objectStorage.send(command as never);
            },
          },
          guard: new PostgresPresignedUploadExpiryGuard({
            pool: postgres,
            transferExpirySeconds: config.media.transferExpirySeconds,
          }),
        }),
        identity: new PostgresIdentityEraser(postgres),
      }),
    });
    const llmRecovery = new PostgresLlmUsageAdapter(postgres, {
      // Recovery SQL is route-independent. Closed placeholders keep the wider
      // usage adapter unavailable to this worker without importing provider config.
      routes: {
        "maxpower/coach-v1": {
          providerId: "worker-unavailable",
          providerModel: "worker-unavailable",
          pricingVersionId: "worker-unavailable",
        },
        "maxpower/nutrition-vision-v1": {
          providerId: "worker-unavailable",
          providerModel: "worker-unavailable",
          pricingVersionId: "worker-unavailable",
        },
      },
    });
    const mediaDeletion = new S3MediaLibraryAdapter({
      pool: postgres as unknown as PostgresPool,
      client: objectStorage,
      bucket: config.objectStorage.bucket,
      transferExpirySeconds: config.media.transferExpirySeconds,
    });
    return { deletion, llmRecovery, mediaDeletion, close };
  } catch (error) {
    await close();
    throw error;
  }
}
