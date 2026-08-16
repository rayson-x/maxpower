import { createApp } from "../app.js";
import {
  InMemoryIdentityAdapter,
  LOCAL_TEST_ONLY_DEBUG_OTP,
} from "../modules/identity/index.js";
import {
  InMemoryProductDataAdapter,
  ProductDataModule,
} from "../modules/product-data/index.js";
import {
  InMemoryMediaLibraryAdapter,
  MediaLibraryModule,
} from "../modules/media/index.js";
import {
  InMemoryLlmEntitlementAdapter,
  InMemoryLlmProviderAdapter,
  InMemoryLlmUsageAdapter,
  LlmGateway,
} from "../modules/llm/index.js";
import {
  AccountDeletionModule,
  InMemoryAccountDeletionAdapter,
} from "../modules/account-deletion/index.js";
import type { HttpSecurityOptions } from "../http/security.js";
import type { HttpRequestLogger } from "../http/request-logger.js";

export interface MemoryRuntimeOptions {
  production: boolean;
  security?: HttpSecurityOptions;
  logger?: HttpRequestLogger;
}

export function createMemoryRuntime(options: MemoryRuntimeOptions) {
  if (options.production) {
    throw new Error("The memory runtime is forbidden in production.");
  }

  const identity = new InMemoryIdentityAdapter();
  const llm = new LlmGateway({
    provider: new InMemoryLlmProviderAdapter(),
    entitlements: new InMemoryLlmEntitlementAdapter(),
    usage: new InMemoryLlmUsageAdapter(),
    fingerprintSecret: "local-contract-runtime-only-secret",
  });

  return {
    app: createApp(
      {
        identity,
        tokens: identity,
        productData: new ProductDataModule({ adapter: new InMemoryProductDataAdapter() }),
        media: new MediaLibraryModule({ adapter: new InMemoryMediaLibraryAdapter() }),
        llm,
        accountDeletion: new AccountDeletionModule({
          adapter: new InMemoryAccountDeletionAdapter(),
        }),
        localDebugOtp: LOCAL_TEST_ONLY_DEBUG_OTP,
      },
      {
        ...(options.security === undefined ? {} : { security: options.security }),
        ...(options.logger === undefined ? {} : { logger: options.logger }),
      },
    ),
  };
}
