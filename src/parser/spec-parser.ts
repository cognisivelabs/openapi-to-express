/**
 * Parses an OpenAPI 3.x spec and extracts structured data for code generation.
 */

import { toPascalCase } from "../utils/strings.js";

export interface ParamInfo {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  type: string; // TypeScript type
}

export interface OperationInfo {
  path: string;
  method: string;
  operationId: string;
  requestType: string | null;
  requestRequired: boolean;
  responseType: string;
  errorTypes: { status: string; type: string }[];
  tag: string;
  pathParams: ParamInfo[];
  queryParams: ParamInfo[];
  headerParams: ParamInfo[];
  summary?: string;
  description?: string;
  deprecated?: boolean;
}

export interface ParsedSpec {
  operations: OperationInfo[];
  schemas: Record<string, any>;
  byTag: Map<string, OperationInfo[]>;
}

export function refToTypeName(ref: string): string {
  const raw = ref.split("/").pop()!;
  return toPascalCase(raw);
}

function schemaTypeToTs(schema: any): string {
  if (!schema) return "string";
  if (schema.type === "integer" || schema.type === "number") return "number";
  if (schema.type === "boolean") return "boolean";
  if (schema.type === "array") return `${schemaTypeToTs(schema.items)}[]`;
  return "string";
}

function resolveParam(p: any, spec: any): any {
  if (p.$ref) {
    // Use raw name (not PascalCased) — parameter keys aren't schema names
    const rawName = p.$ref.split("/").pop()!;
    return spec.components?.parameters?.[rawName] ?? p;
  }
  return p;
}

function extractParams(operation: any, pathItem: any, spec: any): ParamInfo[] {
  const pathParams: any[] = pathItem.parameters ?? [];
  const opParams: any[] = operation.parameters ?? [];

  const merged = new Map<string, any>();
  for (const p of pathParams) {
    const resolved = resolveParam(p, spec);
    merged.set(`${resolved.in}:${resolved.name}`, resolved);
  }
  for (const p of opParams) {
    const resolved = resolveParam(p, spec);
    merged.set(`${resolved.in}:${resolved.name}`, resolved);
  }

  return Array.from(merged.values())
    .filter((p) => p.in === "path" || p.in === "query" || p.in === "header")
    .map((p) => ({
      name: p.name,
      in: p.in,
      required: p.required ?? p.in === "path",
      type: schemaTypeToTs(p.schema),
    }));
}

function resolveSchema(schema: any, operationId: string, suffix: string, schemas: Record<string, any>): string | null {
  if (!schema) return null;
  if (schema.$ref) return refToTypeName(schema.$ref);

  // Inline schema — generate a name and register it
  if (schema.type === "object" || schema.properties || schema.allOf || schema.oneOf || schema.anyOf) {
    const name = `${toPascalCase(operationId)}${suffix}`;
    schemas[name] = schema;
    return name;
  }

  return null;
}

export function parseSpec(spec: any): ParsedSpec {
  const operations: OperationInfo[] = [];

  // Sanitize schema names to valid PascalCase identifiers
  const rawSchemas = spec.components?.schemas ?? {};
  const schemas: Record<string, any> = {};
  for (const [name, schema] of Object.entries<any>(rawSchemas)) {
    schemas[toPascalCase(name)] = schema;
  }

  const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
  const SUCCESS_CODES = ["200", "201", "202", "204"];

  for (const [path, pathItem] of Object.entries<any>(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries<any>(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;
      if (!operation.operationId) continue;

      const tag = operation.tags?.[0] ?? "Default";

      let requestType: string | null = null;
      let requestRequired = true;
      if (operation.requestBody) {
        const bodySchema = operation.requestBody.content?.["application/json"]?.schema;
        requestType = resolveSchema(bodySchema, operation.operationId, "Request", schemas);
        requestRequired = operation.requestBody.required ?? false;
      }

      let responseType = "void";
      for (const code of SUCCESS_CODES) {
        const response = operation.responses?.[code];
        if (response) {
          if (code === "204") {
            // 204 No Content — void return, no body
            responseType = "void";
            break;
          }
          const respSchema = response.content?.["application/json"]?.schema;
          const resolved = resolveSchema(respSchema, operation.operationId, "Response", schemas);
          if (resolved) {
            responseType = resolved;
            break;
          }
        }
      }

      // Extract error response types (4xx, 5xx)
      const errorTypes: { status: string; type: string }[] = [];
      for (const [code, resp] of Object.entries<any>(operation.responses ?? {})) {
        if (code.startsWith("4") || code.startsWith("5")) {
          const errSchema = (resp as any).content?.["application/json"]?.schema;
          const errType = resolveSchema(errSchema, operation.operationId, `Error${code}`, schemas);
          if (errType) {
            errorTypes.push({ status: code, type: errType });
          }
        }
      }

      const allParams = extractParams(operation, pathItem, spec);
      const pathParams = allParams.filter((p) => p.in === "path");
      const queryParams = allParams.filter((p) => p.in === "query");
      const headerParams = allParams.filter((p) => p.in === "header");

      operations.push({
        path, method, operationId: operation.operationId,
        requestType, requestRequired, responseType, errorTypes, tag,
        pathParams, queryParams, headerParams,
        summary: operation.summary,
        description: operation.description,
        deprecated: operation.deprecated ?? false,
      });
    }
  }

  const byTag = new Map<string, OperationInfo[]>();
  for (const op of operations) {
    const ops = byTag.get(op.tag) ?? [];
    ops.push(op);
    byTag.set(op.tag, ops);
  }

  return {
    operations,
    schemas,
    byTag,
  };
}

/**
 * Collect all $ref type names from a schema node (non-recursive into schemas map).
 */
export function collectRefsFromSchema(schema: any, refs: Set<string>): void {
  if (!schema) return;
  if (schema.$ref) refs.add(refToTypeName(schema.$ref));
  if (schema.items) collectRefsFromSchema(schema.items, refs);
  for (const key of ["allOf", "oneOf", "anyOf"] as const) {
    if (schema[key]) {
      for (const sub of schema[key]) collectRefsFromSchema(sub, refs);
    }
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    collectRefsFromSchema(schema.additionalProperties, refs);
  }
  for (const propDef of Object.values<any>(schema.properties ?? {})) {
    collectRefsFromSchema(propDef, refs);
  }
}

/**
 * Walk a named schema recursively through the schemas map, collecting
 * all transitively referenced schema names.
 */
export function walkSchemaRefs(name: string, schemas: Record<string, any>, collected: Set<string>): void {
  if (collected.has(name)) return;
  collected.add(name);
  const schema = schemas[name];
  if (!schema) return;

  const refs = new Set<string>();
  collectRefsFromSchema(schema, refs);
  for (const ref of refs) {
    walkSchemaRefs(ref, schemas, collected);
  }
}

/**
 * Classify schemas into common (multi-tag) vs tag-specific.
 */
export function classifySchemas(
  byTag: Map<string, OperationInfo[]>,
  schemas: Record<string, any>,
): { common: string[]; perTag: Map<string, string[]> } {
  const schemaToTags = new Map<string, Set<string>>();

  for (const [tag, operations] of byTag) {
    const tagSchemas = new Set<string>();
    for (const op of operations) {
      if (op.requestType) walkSchemaRefs(op.requestType, schemas, tagSchemas);
      if (op.responseType !== "void") walkSchemaRefs(op.responseType, schemas, tagSchemas);
      for (const err of op.errorTypes) walkSchemaRefs(err.type, schemas, tagSchemas);
    }
    for (const schema of tagSchemas) {
      const tags = schemaToTags.get(schema) ?? new Set();
      tags.add(tag);
      schemaToTags.set(schema, tags);
    }
  }

  const common: string[] = [];
  const perTag = new Map<string, string[]>();

  for (const [schema, tags] of schemaToTags) {
    if (tags.size > 1) {
      common.push(schema);
    } else {
      const tag = [...tags][0];
      const list = perTag.get(tag) ?? [];
      list.push(schema);
      perTag.set(tag, list);
    }
  }

  return { common: common.sort(), perTag };
}
