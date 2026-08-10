import { Linking, Platform } from "react-native";

import {
  OnlineAuthError,
  availableSocialProviders,
  type SocialAuthorizationPort,
} from "./model";

export interface LinkingSocialAuthorizationOptions {
  callbackUrl: string;
  googleEnabled: boolean;
  timeoutMs?: number;
}

/** System browser + app deep-link implementation with no Better Auth SDK. */
export function createLinkingSocialAuthorizationPort(
  options: LinkingSocialAuthorizationOptions,
): SocialAuthorizationPort {
  const expectedCallback = new URL(options.callbackUrl);
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("social_authorization_timeout_invalid");

  return {
    callbackUrl: expectedCallback.toString(),
    availableProviders: () => availableSocialProviders(Platform.OS, options.googleEnabled),
    async authorize(input) {
      const authorizationUrl = validatedAuthorizationUrl(input.authorizationUrl);
      return await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (result: { status: "success"; callbackUrl: string } | { status: "cancelled" }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          subscription.remove();
          input.signal?.removeEventListener("abort", abort);
          resolve(result);
        };
        const fail = (cause: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          subscription.remove();
          input.signal?.removeEventListener("abort", abort);
          reject(cause);
        };
        const abort = () => fail(new OnlineAuthError("request_aborted"));
        const subscription = Linking.addEventListener("url", ({ url }) => {
          if (sameCallbackTarget(url, expectedCallback)) finish({ status: "success", callbackUrl: url });
        });
        const timeout = setTimeout(() => finish({ status: "cancelled" }), timeoutMs);
        input.signal?.addEventListener("abort", abort, { once: true });
        if (input.signal?.aborted) {
          abort();
          return;
        }
        void Linking.canOpenURL(authorizationUrl.toString())
          .then((supported) => {
            if (!supported) throw new OnlineAuthError("configuration_error", "No system browser can open social login.");
            return Linking.openURL(authorizationUrl.toString());
          })
          .catch(fail);
      });
    },
  };
}

function validatedAuthorizationUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OnlineAuthError("invalid_response", "Social authorization URL is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new OnlineAuthError("invalid_response", "Social authorization URL must use HTTPS.");
  }
  return url;
}

function sameCallbackTarget(value: string, expected: URL): boolean {
  try {
    const actual = new URL(value);
    return actual.protocol === expected.protocol &&
      actual.hostname === expected.hostname &&
      actual.port === expected.port &&
      actual.pathname === expected.pathname;
  } catch {
    return false;
  }
}
