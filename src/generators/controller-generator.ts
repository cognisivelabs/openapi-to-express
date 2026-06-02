/**
 * Generates controller interface files from parsed operations.
 *
 * The controller owns the HTTP layer — it receives Request/Response
 * and is responsible for param extraction, response formatting, and error handling.
 */

import type { OperationInfo } from "../parser/spec-parser.js";
import { toPascalCase, toMethodName, toJsDocLines } from "../utils/strings.js";

export function generateControllerInterface(
  tag: string,
  operations: OperationInfo[],
): string {
  const interfaceName = `${toPascalCase(tag)}Controller`;
  const lines: string[] = [];

  lines.push(`import type { Request, Response } from "express";`);
  lines.push("");

  lines.push(`export interface ${interfaceName} {`);
  for (const op of operations) {
    const methodName = toMethodName(op.operationId);
    if (op.summary || op.description || op.deprecated) {
      lines.push(`  /**`);
      if (op.summary) lines.push(...toJsDocLines(op.summary));
      if (op.summary && op.description) lines.push(`   *`);
      if (op.description) lines.push(...toJsDocLines(op.description));
      if (op.deprecated) lines.push(`   * @deprecated`);
      lines.push(`   */`);
    }
    lines.push(`  ${methodName}(req: Request, res: Response): Promise<void>;`);
  }
  lines.push(`}`, "");

  return lines.join("\n");
}
