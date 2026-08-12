/** Shared validation for first-party cloud adapters. */
export function maxPowerApiOrigin(
  value: string,
  options: { allowInsecureHttp?: boolean } = {},
): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("cloud_api_url_invalid");
  }
  if (
    (parsed.protocol !== "https:"
      && !(options.allowInsecureHttp === true && parsed.protocol === "http:"))
    || !parsed.hostname
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("cloud_api_url_invalid");
  }
  return parsed.origin;
}

export function requiredCloudText(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim() || /[\r\n]/.test(value)) throw new Error(code);
  return value.trim();
}
