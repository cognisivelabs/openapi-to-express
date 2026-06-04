import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSpec } from "../src/parser/spec-parser.js";
import { generateTypesFile } from "../src/generators/types-generator.js";
import { generateControllerInterface } from "../src/generators/controller-generator.js";
import { generateExpressRoutes } from "../src/generators/routes-express-generator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures/petstore.json"), "utf-8"));
const parsed = parseSpec(fixture);
const dirs = { types: "types", controllers: "controllers", routes: "routes" };

describe("generateTypesFile", () => {
  const schemas = ["Pet", "Tag", "CreatePetRequest", "PetListResponse"];
  const { content, imports } = generateTypesFile(schemas, parsed.schemas, new Set());

  it("generates interfaces for all schemas", () => {
    assert.ok(content.includes("export interface Pet {"));
    assert.ok(content.includes("export interface Tag {"));
    assert.ok(content.includes("export interface CreatePetRequest {"));
    assert.ok(content.includes("export interface PetListResponse {"));
  });

  it("marks required fields without ?", () => {
    assert.ok(content.includes("  id: string;"));
    assert.ok(content.includes("  name: string;"));
  });

  it("marks optional fields with ?", () => {
    assert.ok(content.includes("  status?:"));
    assert.ok(content.includes("  tag?:"));
    assert.ok(content.includes("  total?:"));
  });

  it("generates named enum const objects", () => {
    assert.ok(content.includes("status?: PetStatus;"));
    assert.ok(content.includes('export const PetStatus = {'));
    assert.ok(content.includes('Available: "available"'));
    assert.ok(content.includes("export type PetStatus ="));
  });

  it("generates array types", () => {
    assert.ok(content.includes("  pets: Pet[];"));
  });

  it("generates $ref types", () => {
    assert.ok(content.includes("  tag?: Tag;"));
  });

  it("includes JSDoc descriptions", () => {
    assert.ok(content.includes("/** Pet ID */"));
    assert.ok(content.includes("/** Pet name */"));
  });

  it("generates inline object types", () => {
    assert.ok(content.includes("metadata?: { source: string; score?: number }"));
  });

  it("returns no imports when all types are self-contained", () => {
    assert.equal(imports.length, 0);
  });

  it("returns imports for types defined elsewhere", () => {
    const { imports: tagImports } = generateTypesFile(
      ["PetListResponse"],
      parsed.schemas,
      new Set(["Pet"]),
    );
    assert.deepEqual(tagImports, ["Pet"]);
  });
});

describe("generateControllerInterface", () => {
  const petOps = parsed.byTag.get("Pets")!;
  const output = generateControllerInterface("Pets", petOps);

  it("generates interface with correct name", () => {
    assert.ok(output.includes("export interface PetsController {"));
  });

  it("generates method for each operation", () => {
    assert.ok(output.includes("listPets("));
    assert.ok(output.includes("createPet("));
    assert.ok(output.includes("getPetById("));
  });

  it("methods accept req and res", () => {
    assert.ok(output.includes("listPets(req: Request, res: Response): Promise<void>"));
    assert.ok(output.includes("createPet(req: Request, res: Response): Promise<void>"));
    assert.ok(output.includes("getPetById(req: Request, res: Response): Promise<void>"));
  });

  it("imports Express Request and Response types", () => {
    assert.ok(output.includes('import type { Request, Response } from "express"'));
  });

  it("generates JSDoc from summary and description", () => {
    assert.ok(output.includes("   * List all pets"));
    assert.ok(output.includes("   * Returns all pets with optional filtering."));
  });

  it("does not generate JSDoc when no summary or description", () => {
    const getPetLine = output.split("\n").findIndex((l: string) => l.includes("getPetById("));
    const prevLine = output.split("\n")[getPetLine - 1];
    assert.ok(!prevLine.includes("/**") && !prevLine.includes("*/"));
  });
});

describe("generateExpressRoutes", () => {
  const petOps = parsed.byTag.get("Pets")!;
  const output = generateExpressRoutes("Pets", petOps, dirs);

  it("generates router function with correct name", () => {
    assert.ok(output.includes("export function createPetsRouter("));
  });

  it("converts OpenAPI path params to Express format", () => {
    assert.ok(output.includes('"/pets/:petId"'));
  });

  it("generates lean one-liner routes delegating to controller", () => {
    assert.ok(output.includes("controller.listPets(req, res)"));
    assert.ok(output.includes("controller.createPet(req, res)"));
    assert.ok(output.includes("controller.getPetById(req, res)"));
  });

  it("does not extract params — controller handles that", () => {
    assert.ok(!output.includes("req.params."));
    assert.ok(!output.includes("req.query."));
    assert.ok(!output.includes("req.body"));
  });

  it("does not have try/catch — controller handles errors", () => {
    assert.ok(!output.includes("try {"));
    assert.ok(!output.includes("catch"));
  });

  it("imports controller interface", () => {
    assert.ok(output.includes('from "../controllers/pets.controller.interface"'));
  });

  it("generates middleware support", () => {
    assert.ok(output.includes("middleware?: any[]"));
    assert.ok(output.includes("router.use(mw)"));
  });
});

describe("enum naming conventions", () => {
  const schemas = { "Status": { type: "string", enum: ["active_user", "pending_review", "sold_out"] } };

  it("PascalCase (default)", () => {
    const { content } = generateTypesFile(["Status"], schemas, new Set(), "PascalCase");
    assert.ok(content.includes('ActiveUser: "active_user"'));
    assert.ok(content.includes('PendingReview: "pending_review"'));
  });

  it("camelCase", () => {
    const { content } = generateTypesFile(["Status"], schemas, new Set(), "camelCase");
    assert.ok(content.includes('activeUser: "active_user"'));
    assert.ok(content.includes('pendingReview: "pending_review"'));
  });

  it("UPPER_CASE", () => {
    const { content } = generateTypesFile(["Status"], schemas, new Set(), "UPPER_CASE");
    assert.ok(content.includes('ACTIVE_USER: "active_user"'));
    assert.ok(content.includes('PENDING_REVIEW: "pending_review"'));
  });

  it("original", () => {
    const { content } = generateTypesFile(["Status"], schemas, new Set(), "original");
    assert.ok(content.includes('active_user: "active_user"'));
    assert.ok(content.includes('pending_review: "pending_review"'));
  });
});

describe("root-level enum schemas", () => {
  const schemas = {
    "OrderStatus": { type: "string", enum: ["placed", "shipped", "delivered"] },
    "Priority": { type: "integer", enum: [1, 2, 3] },
  };

  it("generates const object for root-level string enum", () => {
    const { content } = generateTypesFile(["OrderStatus"], schemas, new Set());
    assert.ok(content.includes("export const OrderStatus = {"));
    assert.ok(content.includes('Placed: "placed"'));
    assert.ok(content.includes("export type OrderStatus ="));
  });

  it("generates const object for root-level integer enum", () => {
    const { content } = generateTypesFile(["Priority"], schemas, new Set());
    assert.ok(content.includes("export const Priority = {"));
    assert.ok(content.includes("Value1: 1,"));
    assert.ok(content.includes("export type Priority ="));
  });

  it("does not generate inline union for root enums", () => {
    const { content } = generateTypesFile(["OrderStatus"], schemas, new Set());
    assert.ok(!content.includes('export type OrderStatus = "placed" | "shipped" | "delivered"'));
  });
});

