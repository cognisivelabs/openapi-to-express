import { relative, posix } from "node:path";

/**
 * Compute a relative import path from one directory to another.
 *
 * Example: computeRelativeImport("controllers", "types") → "../types"
 *          computeRelativeImport("src/controllers", "src/types") → "../types"
 *          computeRelativeImport("types", "types") → "."
 */
export function computeRelativeImport(fromDir: string, toDir: string): string {
  const rel = relative(fromDir, toDir).split("\\").join(posix.sep);
  if (rel === "") return ".";
  if (!rel.startsWith(".")) return `./${rel}`;
  return rel;
}
