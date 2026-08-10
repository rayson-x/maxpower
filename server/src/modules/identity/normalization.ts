import { ApiError } from "../../kernel/api-error.js";
import type { IdentityIdentifier } from "./model.js";

const EMAIL_MAX_LENGTH = 254;
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

export function normalizeIdentityIdentifier(input: IdentityIdentifier): IdentityIdentifier {
  if (!input || typeof input.value !== "string") {
    throw invalidIdentifier();
  }

  if (input.kind === "email") {
    const value = input.value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
    const at = value.indexOf("@");
    if (
      value.length === 0 ||
      value.length > EMAIL_MAX_LENGTH ||
      at < 1 ||
      at !== value.lastIndexOf("@") ||
      at === value.length - 1 ||
      value.includes(" ") ||
      value.startsWith(".") ||
      value.endsWith(".") ||
      value.includes("..")
    ) {
      throw invalidIdentifier();
    }
    return { kind: "email", value };
  }

  if (input.kind === "phone") {
    const folded = input.value.normalize("NFKC").trim();
    const international = folded.startsWith("00") ? `+${folded.slice(2)}` : folded;
    const value = international.replace(/[\s().-]/g, "");
    if (!PHONE_PATTERN.test(value)) {
      throw invalidIdentifier();
    }
    return { kind: "phone", value };
  }

  throw invalidIdentifier();
}

export function identityIdentifierKey(identifier: IdentityIdentifier): string {
  return `${identifier.kind}:${identifier.value}`;
}

function invalidIdentifier(): ApiError {
  return new ApiError(
    400,
    "invalid_identifier",
    "A valid email address or E.164 phone number is required.",
  );
}
