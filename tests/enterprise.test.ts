import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSpec } from "../src/parser/spec-parser.js";
import { generateTypesFile } from "../src/generators/types-generator.js";
import { generateControllerInterface } from "../src/generators/controller-generator.js";
import { generateExpressRoutes } from "../src/generators/routes-express-generator.js";
import { generate } from "../src/generate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures/enterprise.json"), "utf-8"));
const parsed = parseSpec(fixture);
const dirs = { types: "types", controllers: "controllers", routes: "routes" };

describe("inline schemas", () => {
  it("creates named types from inline request body", () => {
    const createOrder = parsed.operations.find((o) => o.operationId === "createOrder")!;
    assert.equal(createOrder.requestType, "CreateOrderRequest");
    assert.ok(parsed.schemas["CreateOrderRequest"]);
  });

  it("creates named types from inline 201 response", () => {
    const createOrder = parsed.operations.find((o) => o.operationId === "createOrder")!;
    assert.equal(createOrder.responseType, "CreateOrderResponse");
    assert.ok(parsed.schemas["CreateOrderResponse"]);
  });

  it("generates interfaces for inline schemas", () => {
    const schemaNames = ["CreateOrderRequest", "CreateOrderResponse"];
    const { content } = generateTypesFile(schemaNames, parsed.schemas, new Set());
    assert.ok(content.includes("export interface CreateOrderRequest {"));
    assert.ok(content.includes("  item: string;"));
    assert.ok(content.includes("  quantity: number;"));
    assert.ok(content.includes("export interface CreateOrderResponse {"));
    assert.ok(content.includes("  orderId: string;"));
  });
});

describe("$ref parameters", () => {
  it("resolves $ref parameters from components", () => {
    const createOrder = parsed.operations.find((o) => o.operationId === "createOrder")!;
    assert.equal(createOrder.headerParams.length, 2);

    const correlationId = createOrder.headerParams.find((p) => p.name === "X-Correlation-ID")!;
    assert.ok(correlationId);
    assert.equal(correlationId.in, "header");
    assert.equal(correlationId.required, true);
    assert.equal(correlationId.type, "string");

    const tenantId = createOrder.headerParams.find((p) => p.name === "X-Tenant-ID")!;
    assert.ok(tenantId);
  });
});

describe("header parameters", () => {
  it("parses header params from $ref", () => {
    const createOrder = parsed.operations.find((o) => o.operationId === "createOrder")!;
    assert.equal(createOrder.headerParams.length, 2);
    assert.equal(createOrder.headerParams[0].name, "X-Correlation-ID");
  });

  it("routes delegate to controller without extracting headers", () => {
    const ops = parsed.byTag.get("Orders")!;
    const output = generateExpressRoutes("Orders", ops, dirs);
    assert.ok(!output.includes("req.headers"));
    assert.ok(output.includes("controller.createOrder(req, res)"));
  });
});

describe("204 No Content", () => {
  it("returns void for 204 responses", () => {
    const deleteOrder = parsed.operations.find((o) => o.operationId === "deleteOrder")!;
    assert.equal(deleteOrder.responseType, "void");
  });

  it("controller method returns Promise<void>", () => {
    const ops = parsed.byTag.get("Orders")!;
    const output = generateControllerInterface("Orders", ops);
    assert.ok(output.includes("deleteOrder(req: Request, res: Response): Promise<void>"));
  });
});

describe("deprecated operations", () => {
  it("parses deprecated flag", () => {
    const deleteOrder = parsed.operations.find((o) => o.operationId === "deleteOrder")!;
    assert.equal(deleteOrder.deprecated, true);
  });

  it("generates @deprecated JSDoc tag", () => {
    const ops = parsed.byTag.get("Orders")!;
    const output = generateControllerInterface("Orders", ops);
    assert.ok(output.includes("@deprecated"));
    assert.ok(output.includes("Delete an order"));
    assert.ok(output.includes("Use cancelOrder instead."));
  });
});

describe("integer enums", () => {
  it("generates integer enum values without quotes", () => {
    const { content } = generateTypesFile(["Priority"], parsed.schemas, new Set());
    assert.ok(content.includes("level: PriorityLevel;"));
    assert.ok(content.includes("Value1: 1,"));
    assert.ok(content.includes("Value5: 5,"));
    assert.ok(!content.includes('"1"'));
  });
});


describe("readOnly / writeOnly / default", () => {
  it("adds @readonly JSDoc for readOnly properties", () => {
    const { content } = generateTypesFile(["User"], parsed.schemas, new Set());
    assert.ok(content.includes("@readonly"));
    assert.ok(content.includes("Server-generated ID"));
  });

  it("adds @writeOnly JSDoc for writeOnly properties", () => {
    const { content } = generateTypesFile(["User"], parsed.schemas, new Set());
    assert.ok(content.includes("@writeOnly"));
    assert.ok(content.includes("Only for creation"));
  });

  it("adds @default JSDoc for default values", () => {
    const { content } = generateTypesFile(["User"], parsed.schemas, new Set());
    assert.ok(content.includes('@default "user"'));
  });
});

describe("deprecated schemas and properties", () => {
  it("adds @deprecated on interface", () => {
    const { content } = generateTypesFile(["LegacyConfig"], parsed.schemas, new Set());
    assert.ok(content.includes("@deprecated"));
    assert.ok(content.includes("Use NewConfig instead"));
    assert.ok(content.includes("export interface LegacyConfig {"));
  });

  it("adds @deprecated on property", () => {
    const { content } = generateTypesFile(["LegacyConfig"], parsed.schemas, new Set());
    // The property "setting" should have @deprecated in its JSDoc
    const lines = content.split("\n");
    const settingIdx = lines.findIndex((l: string) => l.includes("setting?:"));
    const prevLines = lines.slice(Math.max(0, settingIdx - 4), settingIdx).join("\n");
    assert.ok(prevLines.includes("@deprecated"));
  });
});

describe("error response types", () => {
  it("extracts error types from 4xx responses", () => {
    const createOrder = parsed.operations.find((o: any) => o.operationId === "createOrder")!;
    assert.equal(createOrder.errorTypes.length, 1);
    assert.equal(createOrder.errorTypes[0].status, "400");
    assert.equal(createOrder.errorTypes[0].type, "ValidationError");
  });

  it("includes error types in generated schemas", () => {
    assert.ok(parsed.schemas["ValidationError"]);
  });

  it("generates error type interfaces", () => {
    const { content } = generateTypesFile(["ValidationError"], parsed.schemas, new Set());
    assert.ok(content.includes("export interface ValidationError {"));
    assert.ok(content.includes("code: string;"));
    assert.ok(content.includes("fields: string[];"));
  });
});

describe("format annotations", () => {

  it("adds @format JSDoc for date-time fields", () => {
    const { content } = generateTypesFile(["AuditEntry"], parsed.schemas, new Set());
    assert.ok(content.includes("@format date-time"));
  });

  it("adds @format JSDoc for uuid fields", () => {
    const { content } = generateTypesFile(["AuditEntry"], parsed.schemas, new Set());
    assert.ok(content.includes("@format uuid"));
  });

  it("keeps description alongside format", () => {
    const { content } = generateTypesFile(["AuditEntry"], parsed.schemas, new Set());
    assert.ok(content.includes("Unique audit ID"));
    assert.ok(content.includes("When the action occurred"));
  });
});

describe("discriminator", () => {
  it("generates union type with discriminator JSDoc", () => {
    const { content } = generateTypesFile(
      ["Animal", "Dog", "Cat"],
      parsed.schemas,
      new Set(),
    );
    assert.ok(content.includes("export type Animal = Dog | Cat;"));
    assert.ok(content.includes("@discriminator type"));
  });
});

describe("optional request body", () => {
  it("parses requestRequired from spec", () => {
    const createOrder = parsed.operations.find((o) => o.operationId === "createOrder")!;
    assert.equal(createOrder.requestRequired, true);

    const updateNotes = parsed.operations.find((o) => o.operationId === "updateOrderNotes")!;
    assert.equal(updateNotes.requestRequired, false);
  });

  it("controller methods all use (req, res) regardless of body requirement", () => {
    const ops = parsed.byTag.get("Orders")!;
    const output = generateControllerInterface("Orders", ops);
    assert.ok(output.includes("createOrder(req: Request, res: Response): Promise<void>"));
    assert.ok(output.includes("updateOrderNotes(req: Request, res: Response): Promise<void>"));
  });
});

describe("end-to-end enterprise spec", () => {
  const outDir = join(__dirname, ".enterprise-output");

  before(() => { if (existsSync(outDir)) rmSync(outDir, { recursive: true }); });
  after(() => { if (existsSync(outDir)) rmSync(outDir, { recursive: true }); });

  it("generates all files from enterprise spec", async () => {
    await generate({ input: join(__dirname, "fixtures/enterprise.json"), output: outDir });
    assert.ok(existsSync(join(outDir, "types/orders.types.ts")));
    assert.ok(existsSync(join(outDir, "controllers/orders.controller.interface.ts")));
    assert.ok(existsSync(join(outDir, "routes/orders.routes.ts")));
  });
});
