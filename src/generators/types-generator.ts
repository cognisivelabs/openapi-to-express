/**
 * Generates plain TypeScript interfaces from OpenAPI component schemas.
 *
 * Supports:
 *   - type: "object" with properties
 *   - allOf (intersection / extends)
 *   - oneOf / anyOf (union types)
 *   - $ref, enum, array, primitives
 *   - nullable
 */

import { refToTypeName, collectRefsFromSchema } from "../parser/spec-parser.js";
import { capitalize, enumKeyFromValue, safePropertyName, escapeJsDoc } from "../utils/strings.js";

function toTsType(schema: any): string {
  if (!schema) return "unknown";
  if (schema.$ref) return refToTypeName(schema.$ref);
  if (schema.enum) return schema.enum.map((v: any) => typeof v === "string" ? `"${v}"` : String(v)).join(" | ");
  if (schema.oneOf) return schema.oneOf.map((s: any) => toTsType(s)).join(" | ");
  if (schema.anyOf) return schema.anyOf.map((s: any) => toTsType(s)).join(" | ");
  if (schema.allOf) return schema.allOf.map((s: any) => toTsType(s)).join(" & ");
  if (schema.type === "string") return "string";
  if (schema.type === "integer" || schema.type === "number") return "number";
  if (schema.type === "boolean") return "boolean";
  if (schema.type === "array") return `${toTsType(schema.items)}[]`;
  if (schema.type === "object" && schema.properties) {
    const required = new Set<string>(schema.required ?? []);
    const fields = Object.entries<any>(schema.properties)
      .map(([k, v]) => `${safePropertyName(k)}${required.has(k) ? "" : "?"}: ${toTsType(v)}`)
      .join("; ");
    return `{ ${fields} }`;
  }
  if (schema.type === "object" && schema.additionalProperties) {
    const valType = schema.additionalProperties === true ? "unknown" : toTsType(schema.additionalProperties);
    return `Record<string, ${valType}>`;
  }
  if (schema.type === "object") return "Record<string, unknown>";
  return "unknown";
}

function addNullable(tsType: string, schema: any): string {
  if (schema.nullable) return `${tsType} | null`;
  return tsType;
}


/**
 * Determines if a schema is a composition type (allOf/oneOf/anyOf at the top level
 * without its own properties) and should be generated as a type alias rather than interface.
 */
function isTypeAlias(schema: any): boolean {
  if (schema.oneOf || schema.anyOf) return true;
  if (schema.allOf) {
    // If any sub-schema has properties, this is "extends" → interface, not type alias
    const hasInlineProperties = schema.properties || schema.allOf.some((s: any) => s.properties);
    return !hasInlineProperties;
  }
  return false;
}

/**
 * For allOf schemas that mix $ref with inline properties, collect all inline properties
 * and all $ref base types. This is the "extends" pattern:
 *   allOf:
 *     - $ref: "#/components/schemas/Base"
 *     - type: object
 *       properties: { extra: ... }
 */
function decomposeAllOf(schema: any): { bases: string[]; properties: Record<string, any>; required: string[] } {
  const bases: string[] = [];
  let properties: Record<string, any> = {};
  let required: string[] = [];

  for (const sub of schema.allOf) {
    if (sub.$ref) {
      bases.push(refToTypeName(sub.$ref));
    } else if (sub.properties || sub.type === "object") {
      properties = { ...properties, ...sub.properties };
      required = [...required, ...(sub.required ?? [])];
    }
  }

  // Also merge top-level properties if present alongside allOf
  if (schema.properties) {
    properties = { ...properties, ...schema.properties };
    required = [...required, ...(schema.required ?? [])];
  }

  return { bases, properties, required };
}

interface EnumInfo {
  name: string;
  values: any[];
}

export function generateTypesFile(
  schemaNames: string[],
  allSchemas: Record<string, any>,
  definedElsewhere: Set<string>,
): { content: string; imports: string[] } {
  const defined = new Set(schemaNames);
  const imports = new Set<string>();
  const lines: string[] = [];
  const enums: EnumInfo[] = [];

  for (const name of schemaNames.sort()) {
    const schema = allSchemas[name];
    if (!schema) continue;

    // Collect all referenced types to determine imports
    const refs = new Set<string>();
    collectRefsFromSchema(schema, refs);
    for (const ref of refs) {
      if (!defined.has(ref) && definedElsewhere.has(ref)) {
        imports.add(ref);
      }
    }

    // --- Type alias: oneOf / anyOf / pure allOf ---
    if (isTypeAlias(schema)) {
      const discriminator = schema.discriminator?.propertyName;
      if (schema.description && !discriminator) {
        lines.push(`/** ${escapeJsDoc(schema.description)} */`);
      } else if (schema.description || discriminator) {
        lines.push(`/**`);
        if (schema.description) lines.push(` * ${escapeJsDoc(schema.description)}`);
        if (discriminator) lines.push(` * @discriminator ${discriminator}`);
        lines.push(` */`);
      }

      if (schema.allOf && !schema.properties) {
        const parts = schema.allOf.map((s: any) => toTsType(s));
        lines.push(`export type ${name} = ${parts.join(" & ")};`);
      } else if (schema.oneOf) {
        const parts = schema.oneOf.map((s: any) => toTsType(s));
        lines.push(`export type ${name} = ${parts.join(" | ")};`);
      } else if (schema.anyOf) {
        const parts = schema.anyOf.map((s: any) => toTsType(s));
        lines.push(`export type ${name} = ${parts.join(" | ")};`);
      }

      lines.push("");
      continue;
    }

    // --- Interface: object with properties, or allOf with inline properties ---
    let properties: Record<string, any> = {};
    let required = new Set<string>();
    let extendsClause = "";

    if (schema.allOf) {
      const decomposed = decomposeAllOf(schema);
      properties = decomposed.properties;
      required = new Set(decomposed.required);
      if (decomposed.bases.length > 0) {
        extendsClause = ` extends ${decomposed.bases.join(", ")}`;
      }
    } else if (schema.type === "object" || schema.properties) {
      properties = schema.properties ?? {};
      required = new Set<string>(schema.required ?? []);
    } else {
      // Primitive type alias: type: string, enum, array, etc.
      if (schema.description) {
        lines.push(`/** ${escapeJsDoc(schema.description)} */`);
      }
      const tsType = toTsType(schema);
      lines.push(`export type ${name} = ${tsType};`);
      lines.push("");
      continue;
    }

    if (schema.description || schema.deprecated) {
      if (schema.description && !schema.deprecated) {
        lines.push(`/** ${escapeJsDoc(schema.description)} */`);
      } else {
        lines.push(`/**`);
        if (schema.description) lines.push(` * ${escapeJsDoc(schema.description)}`);
        if (schema.deprecated) lines.push(` * @deprecated`);
        lines.push(` */`);
      }
    }
    lines.push(`export interface ${name}${extendsClause} {`);

    for (const [prop, propDef] of Object.entries<any>(properties)) {
      const optional = required.has(prop) ? "" : "?";
      let tsType: string;

      if (propDef.enum) {
        // Generate a named enum const — use InterfaceProp naming
        const enumName = `${name}${capitalize(prop)}`;
        enums.push({ name: enumName, values: propDef.enum });
        tsType = enumName;
      } else {
        tsType = toTsType(propDef);
      }

      tsType = addNullable(tsType, propDef);

      // JSDoc: description + annotations
      const docParts: string[] = [];
      if (propDef.description) docParts.push(escapeJsDoc(propDef.description));
      if (propDef.format) docParts.push(`@format ${propDef.format}`);
      if (propDef.readOnly) docParts.push(`@readonly`);
      if (propDef.writeOnly) docParts.push(`@writeOnly`);
      if (propDef.default !== undefined) {
        const defaultVal = typeof propDef.default === "string" ? `"${propDef.default}"` : String(propDef.default);
        docParts.push(`@default ${defaultVal}`);
      }
      if (propDef.deprecated) docParts.push(`@deprecated`);
      if (docParts.length === 1) {
        lines.push(`  /** ${docParts[0]} */`);
      } else if (docParts.length > 1) {
        lines.push(`  /**`);
        for (const part of docParts) lines.push(`   * ${part}`);
        lines.push(`   */`);
      }
      lines.push(`  ${safePropertyName(prop)}${optional}: ${tsType};`);
    }

    lines.push(`}`, "");
  }

  // Append enum const objects
  if (enums.length > 0) {
    for (const e of enums) {
      lines.push(`export const ${e.name} = {`);
      for (const val of e.values) {
        const key = typeof val === "string" ? enumKeyFromValue(val) : `Value${val}`;
        const literal = typeof val === "string" ? `"${val}"` : String(val);
        lines.push(`  ${key}: ${literal},`);
      }
      lines.push(`} as const;`);
      lines.push(`export type ${e.name} = (typeof ${e.name})[keyof typeof ${e.name}];`);
      lines.push("");
    }
  }

  return { content: lines.join("\n"), imports: Array.from(imports).sort() };
}
