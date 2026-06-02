import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSpec, classifySchemas } from "../src/parser/spec-parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures/petstore.json"), "utf-8"));

describe("parseSpec", () => {
  const parsed = parseSpec(fixture);

  it("extracts all operations", () => {
    assert.equal(parsed.operations.length, 4);
  });

  it("extracts operationIds", () => {
    const ids = parsed.operations.map((o) => o.operationId).sort();
    assert.deepEqual(ids, ["createPet", "getInventory", "getPetById", "listPets"]);
  });

  it("groups operations by tag", () => {
    assert.equal(parsed.byTag.size, 2);
    assert.equal(parsed.byTag.get("Pets")!.length, 3);
    assert.equal(parsed.byTag.get("Store")!.length, 1);
  });

  it("extracts request body type", () => {
    const createPet = parsed.operations.find((o) => o.operationId === "createPet")!;
    assert.equal(createPet.requestType, "CreatePetRequest");
  });

  it("extracts response type", () => {
    const listPets = parsed.operations.find((o) => o.operationId === "listPets")!;
    assert.equal(listPets.responseType, "PetListResponse");
  });

  it("sets null requestType when no body", () => {
    const listPets = parsed.operations.find((o) => o.operationId === "listPets")!;
    assert.equal(listPets.requestType, null);
  });

  it("extracts path parameters", () => {
    const getPet = parsed.operations.find((o) => o.operationId === "getPetById")!;
    assert.equal(getPet.pathParams.length, 1);
    assert.equal(getPet.pathParams[0].name, "petId");
    assert.equal(getPet.pathParams[0].in, "path");
    assert.equal(getPet.pathParams[0].required, true);
    assert.equal(getPet.pathParams[0].type, "string");
  });

  it("extracts query parameters", () => {
    const listPets = parsed.operations.find((o) => o.operationId === "listPets")!;
    assert.equal(listPets.queryParams.length, 2);

    const limit = listPets.queryParams.find((p) => p.name === "limit")!;
    assert.equal(limit.type, "number");
    assert.equal(limit.required, false);

    const status = listPets.queryParams.find((p) => p.name === "status")!;
    assert.equal(status.type, "string");
    assert.equal(status.required, true);
  });

  it("extracts all schemas", () => {
    const names = Object.keys(parsed.schemas).sort();
    assert.deepEqual(names, ["CreatePetRequest", "Inventory", "Pet", "PetListResponse", "Tag"]);
  });
});

describe("classifySchemas", () => {
  const parsed = parseSpec(fixture);
  const { common, perTag } = classifySchemas(parsed.byTag, parsed.schemas);

  it("identifies tag-specific schemas", () => {
    const petSchemas = (perTag.get("Pets") ?? []).sort();
    assert.ok(petSchemas.includes("Pet"));
    assert.ok(petSchemas.includes("CreatePetRequest"));
    assert.ok(petSchemas.includes("PetListResponse"));

    const storeSchemas = (perTag.get("Store") ?? []).sort();
    assert.ok(storeSchemas.includes("Inventory"));
  });

  it("has no common schemas when tags don't share models", () => {
    assert.equal(common.length, 0);
  });
});
