import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSpec, formatValidationReport } from "../src/validator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("validateSpec — good spec", () => {
  const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures/petstore.json"), "utf-8"));
  const result = validateSpec(fixture);

  it("reports all operations as ready", () => {
    assert.equal(result.readyCount, result.operationCount);
  });

  it("has no errors", () => {
    const errors = result.issues.filter((i) => i.level === "error");
    assert.equal(errors.length, 0);
  });
});

describe("validateSpec — missing operationId", () => {
  const spec = {
    openapi: "3.0.3",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/test": {
        get: {
          responses: { "200": { description: "OK" } },
        },
      },
    },
  };
  const result = validateSpec(spec);

  it("reports error for missing operationId", () => {
    const errors = result.issues.filter((i) => i.level === "error");
    assert.ok(errors.some((e) => e.message.includes("operationId")));
  });

  it("marks operation as not ready", () => {
    assert.equal(result.readyCount, 0);
  });
});

describe("validateSpec — missing tags", () => {
  const spec = {
    openapi: "3.0.3",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/test": {
        get: {
          operationId: "getTest",
          responses: { "200": { description: "OK" } },
        },
      },
    },
  };
  const result = validateSpec(spec);

  it("warns about missing tags", () => {
    const warnings = result.issues.filter((i) => i.level === "warning");
    assert.ok(warnings.some((w) => w.message.includes("No tags")));
  });

  it("still marks as ready (warning not error)", () => {
    assert.equal(result.readyCount, 1);
  });
});

describe("validateSpec — example without schema", () => {
  const spec = {
    openapi: "3.0.3",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/test": {
        get: {
          operationId: "getTest",
          tags: ["Test"],
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  example: { foo: "bar" },
                },
              },
            },
          },
        },
      },
    },
  };
  const result = validateSpec(spec);

  it("reports error for example without schema", () => {
    const errors = result.issues.filter((i) => i.level === "error");
    assert.ok(errors.some((e) => e.message.includes("example") && e.message.includes("schema")));
  });

  it("marks operation as not ready", () => {
    assert.equal(result.readyCount, 0);
  });
});

describe("validateSpec — request body without schema", () => {
  const spec = {
    openapi: "3.0.3",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/test": {
        post: {
          operationId: "createTest",
          tags: ["Test"],
          requestBody: {
            content: {
              "application/json": {
                example: { name: "test" },
              },
            },
          },
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { type: "object", properties: { id: { type: "string" } } },
                },
              },
            },
          },
        },
      },
    },
  };
  const result = validateSpec(spec);

  it("reports error for request body example without schema", () => {
    const errors = result.issues.filter((i) => i.level === "error");
    assert.ok(errors.some((e) => e.message.includes("RequestBody") && e.message.includes("schema")));
  });
});

describe("validateSpec — form-urlencoded", () => {
  const spec = {
    openapi: "3.0.3",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/token": {
        post: {
          operationId: "getToken",
          tags: ["Auth"],
          requestBody: {
            content: {
              "application/x-www-form-urlencoded": {
                schema: { type: "object", properties: { code: { type: "string" } } },
              },
            },
          },
          responses: { "200": { description: "OK" } },
        },
      },
    },
  };
  const result = validateSpec(spec);

  it("warns about form-urlencoded", () => {
    const warnings = result.issues.filter((i) => i.level === "warning");
    assert.ok(warnings.some((w) => w.message.includes("x-www-form-urlencoded")));
  });

  it("still marks as ready", () => {
    assert.equal(result.readyCount, 1);
  });
});

describe("validateSpec — unresolvable $ref", () => {
  const spec = {
    openapi: "3.0.3",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/test": {
        get: {
          operationId: "getTest",
          tags: ["Test"],
          parameters: [{ $ref: "#/components/parameters/Missing" }],
          responses: { "200": { description: "OK" } },
        },
      },
    },
    components: { parameters: {} },
  };
  const result = validateSpec(spec);

  it("reports error for unresolvable parameter $ref", () => {
    const errors = result.issues.filter((i) => i.level === "error");
    assert.ok(errors.some((e) => e.message.includes("$ref") && e.message.includes("cannot be resolved")));
  });
});

describe("validateSpec — no paths", () => {
  const spec = {
    openapi: "3.0.3",
    info: { title: "Test", version: "1.0.0" },
    paths: {},
  };
  const result = validateSpec(spec);

  it("reports error for empty paths", () => {
    assert.ok(result.issues.some((i) => i.message.includes("No paths")));
  });
});

describe("formatValidationReport — standard mode", () => {
  const spec = {
    openapi: "3.0.3",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/test": {
        get: {
          operationId: "getTest",
          responses: { "200": { description: "OK" } },
        },
      },
    },
  };
  const result = validateSpec(spec);
  const report = formatValidationReport(result, "standard");

  it("hides warnings in standard mode", () => {
    assert.ok(!report.includes("No tags"));
  });

  it("shows mode label", () => {
    assert.ok(report.includes("Mode: standard"));
  });
});

describe("formatValidationReport — strict mode", () => {
  const spec = {
    openapi: "3.0.3",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/test": {
        get: {
          operationId: "getTest",
          responses: { "200": { description: "OK" } },
        },
      },
    },
  };
  const result = validateSpec(spec);
  const report = formatValidationReport(result, "strict");

  it("shows warnings in strict mode", () => {
    assert.ok(report.includes("No tags"));
  });

  it("shows mode label", () => {
    assert.ok(report.includes("Mode: strict"));
  });
});

describe("formatValidationReport — clean spec", () => {
  const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures/petstore.json"), "utf-8"));
  const result = validateSpec(fixture);
  const report = formatValidationReport(result);

  it("shows all-green message", () => {
    assert.ok(report.includes("✅ All operations are ready"));
  });
});
