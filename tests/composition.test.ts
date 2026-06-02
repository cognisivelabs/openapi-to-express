import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSpec, walkSchemaRefs } from "../src/parser/spec-parser.js";
import { generateTypesFile } from "../src/generators/types-generator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures/composition.json"), "utf-8"));
const parsed = parseSpec(fixture);

describe("allOf — extends pattern", () => {
  const schemas = ["BaseEntity", "UserEvent", "SystemEvent"];
  const { content } = generateTypesFile(schemas, parsed.schemas, new Set());

  it("generates base interface", () => {
    assert.ok(content.includes("export interface BaseEntity {"));
    assert.ok(content.includes("  id: string;"));
    assert.ok(content.includes("  createdAt: string;"));
  });

  it("generates extending interface with extends clause", () => {
    assert.ok(content.includes("export interface UserEvent extends BaseEntity {"));
    assert.ok(content.includes("  eventType: string;"));
  });

  it("generates second extending interface", () => {
    assert.ok(content.includes("export interface SystemEvent extends BaseEntity {"));
    assert.ok(content.includes("  source: string;"));
  });

  it("handles enum in allOf child as named const", () => {
    assert.ok(content.includes("severity?: SystemEventSeverity;"));
    assert.ok(content.includes('export const SystemEventSeverity = {'));
  });

  it("handles nullable fields", () => {
    assert.ok(content.includes("metadata?: string | null;"));
  });
});

describe("oneOf — union type", () => {
  const schemas = ["Event", "UserEvent", "SystemEvent", "BaseEntity"];
  const { content } = generateTypesFile(schemas, parsed.schemas, new Set());

  it("generates type alias with union", () => {
    assert.ok(content.includes("export type Event = UserEvent | SystemEvent;"));
  });

  it("includes JSDoc description", () => {
    assert.ok(content.includes("/** Any event in the system */"));
  });
});

describe("anyOf — union type", () => {
  const schemas = ["Notification", "EmailNotification", "SmsNotification"];
  const { content } = generateTypesFile(schemas, parsed.schemas, new Set());

  it("generates type alias with union", () => {
    assert.ok(content.includes("export type Notification = EmailNotification | SmsNotification;"));
  });

  it("includes description", () => {
    assert.ok(content.includes("/** A notification that can be email or SMS */"));
  });
});

describe("walkSchemaRefs — composition", () => {
  it("follows allOf refs", () => {
    const collected = new Set<string>();
    walkSchemaRefs("UserEvent", parsed.schemas, collected);
    assert.ok(collected.has("UserEvent"));
    assert.ok(collected.has("BaseEntity"));
  });

  it("follows oneOf refs", () => {
    const collected = new Set<string>();
    walkSchemaRefs("Event", parsed.schemas, collected);
    assert.ok(collected.has("Event"));
    assert.ok(collected.has("UserEvent"));
    assert.ok(collected.has("SystemEvent"));
    assert.ok(collected.has("BaseEntity"));
  });

  it("follows anyOf refs", () => {
    const collected = new Set<string>();
    walkSchemaRefs("Notification", parsed.schemas, collected);
    assert.ok(collected.has("Notification"));
    assert.ok(collected.has("EmailNotification"));
    assert.ok(collected.has("SmsNotification"));
  });
});
