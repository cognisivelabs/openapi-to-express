/**
 * Validates an OpenAPI spec for code generation readiness.
 * Reports what's missing or problematic for generating types,
 * controller interfaces, and routes.
 */

export interface ValidationIssue {
  level: "error" | "warning";
  path: string;
  method: string;
  message: string;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  operationCount: number;
  readyCount: number;
}

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

export function validateSpec(spec: any): ValidationResult {
  const issues: ValidationIssue[] = [];
  let operationCount = 0;
  let readyCount = 0;

  if (!spec.paths || Object.keys(spec.paths).length === 0) {
    issues.push({ level: "error", path: "/", method: "", message: "No paths defined in spec" });
    return { issues, operationCount: 0, readyCount: 0 };
  }

  for (const [path, pathItem] of Object.entries<any>(spec.paths)) {
    for (const [method, operation] of Object.entries<any>(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;
      operationCount++;

      const ctx = `${method.toUpperCase()} ${path}`;
      let isReady = true;

      // operationId
      if (!operation.operationId) {
        issues.push({ level: "error", path, method, message: "Missing operationId — cannot generate controller method name" });
        isReady = false;
      }

      // tags
      if (!operation.tags || operation.tags.length === 0) {
        issues.push({ level: "warning", path, method, message: "No tags — will be grouped under \"Default\"" });
      }

      // Request body
      if (operation.requestBody) {
        const content = operation.requestBody.content;
        if (!content) {
          issues.push({ level: "error", path, method, message: "RequestBody has no content defined" });
          isReady = false;
        } else if (content["application/json"]) {
          const jsonContent = content["application/json"];
          if (!jsonContent.schema) {
            if (jsonContent.example || jsonContent.examples) {
              issues.push({ level: "error", path, method, message: "RequestBody has \"example\" but no \"schema\" — cannot generate request type" });
            } else {
              issues.push({ level: "error", path, method, message: "RequestBody application/json has no schema defined" });
            }
            isReady = false;
          }
        } else if (content["application/x-www-form-urlencoded"]) {
          const formContent = content["application/x-www-form-urlencoded"];
          if (!formContent.schema) {
            issues.push({ level: "warning", path, method, message: "RequestBody uses application/x-www-form-urlencoded without schema" });
          } else {
            issues.push({ level: "warning", path, method, message: "RequestBody uses application/x-www-form-urlencoded — only application/json generates typed request body" });
          }
        } else {
          const contentTypes = Object.keys(content).join(", ");
          issues.push({ level: "warning", path, method, message: `RequestBody uses unsupported content type: ${contentTypes} — only application/json generates types` });
        }
      }

      // Responses
      const responses = operation.responses ?? {};
      const successCodes = ["200", "201", "202"];
      let hasSuccessSchema = false;
      let has204 = false;

      for (const [code, response] of Object.entries<any>(responses)) {
        if (code === "204") {
          has204 = true;
          hasSuccessSchema = true;
          continue;
        }

        if (!successCodes.includes(code)) continue;
        hasSuccessSchema = true; // A success code exists, even if schema is missing

        const content = (response as any).content;
        if (!content) {
          issues.push({ level: "warning", path, method, message: `Response ${code} has no content — will return void` });
          continue;
        }

        const jsonContent = content["application/json"];
        if (!jsonContent) {
          const contentTypes = Object.keys(content).join(", ");
          issues.push({ level: "warning", path, method, message: `Response ${code} uses ${contentTypes} — only application/json generates types` });
          continue;
        }

        if (!jsonContent.schema) {
          if (jsonContent.example || jsonContent.examples) {
            issues.push({ level: "error", path, method, message: `Response ${code} has \"example\" but no \"schema\" — cannot generate response type` });
          } else {
            issues.push({ level: "error", path, method, message: `Response ${code} application/json has no schema defined` });
          }
          isReady = false;
        } else {
          hasSuccessSchema = true;
        }
      }

      if (!hasSuccessSchema && !has204 && Object.keys(responses).length > 0) {
        const codes = Object.keys(responses).join(", ");
        issues.push({ level: "warning", path, method, message: `No success response (200/201/202/204) found — only has: ${codes}` });
      }

      // Error responses — check for schemas
      for (const [code, response] of Object.entries<any>(responses)) {
        if (!code.startsWith("4") && !code.startsWith("5")) continue;
        const jsonContent = (response as any).content?.["application/json"];
        if (jsonContent && !jsonContent.schema && (jsonContent.example || jsonContent.examples)) {
          issues.push({ level: "warning", path, method, message: `Response ${code} has \"example\" but no \"schema\" — error type won't be generated` });
        }
      }

      // Parameters with $ref — check they resolve
      for (const param of (operation.parameters ?? [])) {
        if (param.$ref) {
          const refName = param.$ref.split("/").pop();
          const resolved = spec.components?.parameters?.[refName];
          if (!resolved) {
            issues.push({ level: "error", path, method, message: `Parameter $ref "${param.$ref}" cannot be resolved` });
            isReady = false;
          }
        }
      }

      // Schema $refs — check they exist
      checkSchemaRefs(operation, spec, path, method, issues);

      if (isReady) readyCount++;
    }
  }

  // Check component schemas
  const schemas = spec.components?.schemas ?? {};
  for (const [name, schema] of Object.entries<any>(schemas)) {
    if (schema.type === "object" && !schema.properties && !schema.allOf && !schema.oneOf && !schema.anyOf && !schema.additionalProperties) {
      issues.push({ level: "warning", path: `#/components/schemas/${name}`, method: "", message: "Schema is type \"object\" but has no properties — will generate empty interface" });
    }
  }

  return { issues, operationCount, readyCount };
}

function checkSchemaRefs(obj: any, spec: any, path: string, method: string, issues: ValidationIssue[]): void {
  if (!obj || typeof obj !== "object") return;

  if (obj.$ref && typeof obj.$ref === "string" && obj.$ref.startsWith("#/components/schemas/")) {
    const name = obj.$ref.split("/").pop();
    if (!spec.components?.schemas?.[name]) {
      issues.push({ level: "error", path, method, message: `Schema $ref "${obj.$ref}" not found in components/schemas` });
    }
  }

  for (const value of Object.values(obj)) {
    if (typeof value === "object" && value !== null) {
      checkSchemaRefs(value, spec, path, method, issues);
    }
  }
}

export function formatValidationReport(result: ValidationResult, mode: "strict" | "standard" = "strict"): string {
  const lines: string[] = [];
  const showWarnings = mode === "strict";

  const filtered = showWarnings
    ? result.issues
    : result.issues.filter((i) => i.level === "error");

  lines.push("OpenAPI Code Generation Readiness Report");
  lines.push(`Mode: ${mode}`);
  lines.push("=========================================");
  lines.push("");

  if (filtered.length === 0) {
    lines.push("✅ All operations are ready for code generation.");
    lines.push("");
    lines.push(`${result.operationCount} operations, ${result.readyCount} ready.`);
    return lines.join("\n");
  }

  // Group issues by path+method
  const grouped = new Map<string, ValidationIssue[]>();
  for (const issue of filtered) {
    const key = issue.method ? `${issue.method.toUpperCase()} ${issue.path}` : issue.path;
    const list = grouped.get(key) ?? [];
    list.push(issue);
    grouped.set(key, list);
  }

  for (const [operation, opIssues] of grouped) {
    const hasError = opIssues.some((i) => i.level === "error");
    const icon = hasError ? "❌" : "⚠️";
    lines.push(`${icon} ${operation}`);
    for (const issue of opIssues) {
      const marker = issue.level === "error" ? "✗" : "⚠";
      lines.push(`  └─ ${marker} ${issue.message}`);
    }
    lines.push("");
  }

  const errors = result.issues.filter((i) => i.level === "error").length;
  const warnings = result.issues.filter((i) => i.level === "warning").length;

  lines.push("─────────────────────────────────────────");
  lines.push(`Summary: ${result.operationCount} operations, ${result.readyCount} ready for codegen`);
  if (errors > 0) lines.push(`  ${errors} error(s) — must fix for code generation`);
  if (showWarnings && warnings > 0) lines.push(`  ${warnings} warning(s) — optional improvements`);

  return lines.join("\n");
}
