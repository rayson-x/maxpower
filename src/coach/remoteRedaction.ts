export interface DirectIdentifierRedaction {
  text: string;
  redactedPaths: readonly string[];
}

/**
 * Deterministic direct-identifier scrub used at every remote LLM egress.
 * It targets explicit labels and transport-safe identifier shapes instead of
 * claiming to infer all personal information from free prose.
 */
export function redactDirectIdentifiers(
  input: string,
  pathPrefix: string,
): DirectIdentifierRedaction {
  let text = input;
  const redactedPaths = new Set<string>();
  const replace = (pattern: RegExp, suffix: string, labelled = false) => {
    text = text.replace(pattern, (_match, label?: string) => {
      redactedPaths.add(`${pathPrefix}.${suffix}`);
      return labelled && label ? `${label}[已移除]` : "[已移除]";
    });
  };

  replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "email");
  replace(/\+\d[\d\s().-]{6,}\d/g, "phone");
  replace(/\b1[3-9]\d{9}\b/g, "phone");
  replace(/\b\d{3}[\s().-]?\d{3}[\s.-]?\d{4}\b/g, "phone");
  replace(/((?:姓名|名字|name)\s*[:：]\s*)[^\n,，;；]{1,80}/gi, "name", true);
  replace(/((?:地址|住址|address)\s*[:：]\s*)[^\n;；]{1,160}/gi, "address", true);
  replace(/((?:经纬度|坐标|location)\s*[:：]\s*)[^\n;；]{1,120}/gi, "exact_location", true);

  return { text, redactedPaths: [...redactedPaths] };
}
