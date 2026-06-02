/**
 * Generates lean Express router files — one line per endpoint.
 *
 * Routes are pure wiring: HTTP method + path → controller method.
 * The controller handles param extraction, response formatting, and errors.
 */

import type { OperationInfo } from "../parser/spec-parser.js";
import type { DirectoryConfig } from "../generate.js";
import { computeRelativeImport } from "../utils/paths.js";
import { toPascalCase, toMethodName } from "../utils/strings.js";

function toExpressPath(path: string): string {
  return path.replace(/\{(\w+)\}/g, ":$1");
}

export function generateExpressRoutes(
  tag: string,
  operations: OperationInfo[],
  dirs: DirectoryConfig,
): string {
  const pascalTag = toPascalCase(tag);
  const interfaceName = `${pascalTag}Controller`;
  const tagLower = tag.toLowerCase();
  const toControllers = computeRelativeImport(dirs.routes, dirs.controllers);

  const lines = [
    `import { Router } from "express";`,
    `import type { ${interfaceName} } from "${toControllers}/${tagLower}.controller.interface";`,
    ``,
    `export function create${pascalTag}Router(controller: ${interfaceName}, middleware?: any[]): Router {`,
    `  const router = Router();`,
    ``,
    `  if (middleware) {`,
    `    middleware.forEach((mw) => router.use(mw));`,
    `  }`,
    ``,
  ];

  for (const op of operations) {
    const expressPath = toExpressPath(op.path);
    const methodName = toMethodName(op.operationId);
    lines.push(`  router.${op.method}("${expressPath}", (req, res) => controller.${methodName}(req, res));`);
  }

  lines.push(``);
  lines.push(`  return router;`);
  lines.push(`}`, "");
  return lines.join("\n");
}
