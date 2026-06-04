/**
 * Shared string utilities.
 */

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Convert a string to PascalCase.
 * "repos" → "Repos", "pull-requests" → "PullRequests", "code_scanning" → "CodeScanning"
 */
export function toPascalCase(s: string): string {
  return s
    .split(/[_\-\s\/\.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Convert an operationId to a valid JS identifier.
 * "repos/list-for-org" → "reposListForOrg"
 * "get-user" → "getUser"
 * "get.user.by-id_v2" → "getUserByIdV2"
 */
export function toMethodName(operationId: string): string {
  const parts = operationId.split(/[\/\-_\.\s]+/).filter(Boolean);
  if (parts.length === 0) return operationId;
  return parts[0] + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

/**
 * Escape `* /` sequences that would break JSDoc comments.
 */
export function escapeJsDoc(text: string): string {
  return text.replace(/\*\//g, "*\\/");
}

/**
 * Sanitize a description for JSDoc — handle multi-line content.
 * Returns lines with `   * ` prefix (indented for interface methods).
 */
export function toJsDocLines(text: string): string[] {
  return escapeJsDoc(text).split("\n").map((line) => `   * ${line}`);
}

/**
 * Check if a string is a valid JS identifier (can be used unquoted as a property name).
 */
function isValidIdentifier(s: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s);
}

/**
 * Quote a property name if it's not a valid JS identifier.
 */
export function safePropertyName(name: string): string {
  return isValidIdentifier(name) ? name : `"${name}"`;
}

export type EnumNaming = "PascalCase" | "camelCase" | "UPPER_CASE" | "original";

export function enumKeyFromValue(value: any, naming: EnumNaming = "PascalCase"): string {
  const str = String(value);

  // For "original", return as-is if it's a valid identifier, otherwise sanitize
  if (naming === "original") {
    const cleaned = str.replace(/[^a-zA-Z0-9_$]+/g, "_").replace(/^_+|_+$/g, "");
    if (!cleaned || /^[0-9]/.test(cleaned)) return `Value_${cleaned}`;
    return cleaned;
  }

  const cleaned = str
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!cleaned || /^[0-9]/.test(cleaned)) {
    return `Value_${cleaned || str.replace(/[^a-zA-Z0-9]/g, "")}`;
  }

  const parts = cleaned.split("_").filter(Boolean);

  switch (naming) {
    case "PascalCase":
      return parts
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join("");
    case "camelCase":
      return parts[0].toLowerCase() +
        parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join("");
    case "UPPER_CASE":
      return parts.map((p) => p.toUpperCase()).join("_");
    default:
      return parts
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join("");
  }
}
