/**
 * Tests for coverage gaps: dry-run, barrel files, 204 routes,
 * optional query NaN guard, computeRelativeImport, skipped operations.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "../src/generate.js";
import { parseSpec } from "../src/parser/spec-parser.js";
import { generateExpressRoutes } from "../src/generators/routes-express-generator.js";
import { generateTypesFile } from "../src/generators/types-generator.js";
import { computeRelativeImport } from "../src/utils/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const petstoreFixture = join(__dirname, "fixtures/petstore.json");
const enterpriseFixture = join(__dirname, "fixtures/enterprise.json");
const outDir = join(__dirname, ".coverage-output");
const dirs = { types: "types", controllers: "controllers", routes: "routes" };

function cleanup() {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
}

describe("dry-run", () => {
  before(cleanup);
  after(cleanup);

  it("does not write any files", async () => {
    await generate({ input: petstoreFixture, output: outDir, dryRun: true });
    assert.ok(!existsSync(outDir));
  });
});

describe("barrel / index.ts files", () => {
  before(cleanup);
  after(cleanup);

  it("generates index.ts in each output directory", async () => {
    await generate({ input: petstoreFixture, output: outDir });
    assert.ok(existsSync(join(outDir, "types/index.ts")));
    assert.ok(existsSync(join(outDir, "controllers/index.ts")));
    assert.ok(existsSync(join(outDir, "routes/index.ts")));
  });

  it("index.ts re-exports all files in directory", async () => {
    const typesIndex = readFileSync(join(outDir, "types/index.ts"), "utf-8");
    assert.ok(typesIndex.includes('export * from "./pets.types"'));
    assert.ok(typesIndex.includes('export * from "./store.types"'));

    const ctrlIndex = readFileSync(join(outDir, "controllers/index.ts"), "utf-8");
    assert.ok(ctrlIndex.includes('export * from "./pets.controller.interface"'));

    const routesIndex = readFileSync(join(outDir, "routes/index.ts"), "utf-8");
    assert.ok(routesIndex.includes('export * from "./pets.routes"'));
  });
});

describe("lean routes delegation", () => {
  const enterprise = JSON.parse(readFileSync(enterpriseFixture, "utf-8"));
  const parsed = parseSpec(enterprise);
  const ops = parsed.byTag.get("Orders")!;
  const output = generateExpressRoutes("Orders", ops, dirs);

  it("generates one-liner delegation for each operation", () => {
    assert.ok(output.includes("controller.createOrder(req, res)"));
    assert.ok(output.includes("controller.deleteOrder(req, res)"));
    assert.ok(output.includes("controller.updateOrderNotes(req, res)"));
  });

  it("has no param extraction, no try/catch, no res.json", () => {
    assert.ok(!output.includes("req.params."));
    assert.ok(!output.includes("req.body"));
    assert.ok(!output.includes("try {"));
    assert.ok(!output.includes("res.json"));
    assert.ok(!output.includes("res.status"));
  });
});

describe("computeRelativeImport", () => {
  it("sibling directories", () => {
    assert.equal(computeRelativeImport("controllers", "types"), "../types");
  });

  it("same directory", () => {
    assert.equal(computeRelativeImport("types", "types"), ".");
  });

  it("nested directories", () => {
    assert.equal(computeRelativeImport("src/controllers", "src/types"), "../types");
  });

  it("deeply nested to sibling", () => {
    assert.equal(computeRelativeImport("a/b/c", "a/b/d"), "../d");
  });
});

describe("operations without operationId", () => {
  const spec = {
    openapi: "3.0.3",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/items": {
        get: {
          operationId: "listItems",
          tags: ["Items"],
          responses: { "200": { description: "OK" } },
        },
        post: {
          // No operationId — should be skipped
          tags: ["Items"],
          responses: { "200": { description: "OK" } },
        },
      },
    },
    components: { schemas: {} },
  };

  it("skips operations without operationId", () => {
    const parsed = parseSpec(spec);
    assert.equal(parsed.operations.length, 1);
    assert.equal(parsed.operations[0].operationId, "listItems");
  });
});

describe("additionalProperties", () => {
  const spec = {
    openapi: "3.0.3",
    info: { title: "Test", version: "1.0.0" },
    paths: {},
    components: {
      schemas: {
        Metadata: {
          type: "object",
          properties: {
            tags: { type: "object", additionalProperties: { type: "string" } },
            data: { type: "object", additionalProperties: true },
          },
        },
      },
    },
  };

  it("generates Record<string, T> for typed additionalProperties", () => {
    const parsed = parseSpec(spec);
    const { content } = generateTypesFile(["Metadata"], parsed.schemas, new Set());
    assert.ok(content.includes("tags?: Record<string, string>"));
    assert.ok(content.includes("data?: Record<string, unknown>"));
  });
});
