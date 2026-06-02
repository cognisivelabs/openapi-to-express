import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmpDir = join(__dirname, ".config-test");

function cleanup() {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
}

describe("loadConfig", () => {
  before(() => {
    cleanup();
    mkdirSync(tmpDir, { recursive: true });
  });
  after(cleanup);

  it("returns null when no config file exists", () => {
    const result = loadConfig(join(tmpDir, "nonexistent"));
    assert.equal(result, null);
  });

  it("loads config from .openapi-to-expressrc.json", () => {
    const config = {
      input: "openapi.yaml",
      output: "src",
      "types-dir": "models",
      "controllers-dir": "interfaces",
      "routes-dir": "api",
    };
    writeFileSync(join(tmpDir, ".openapi-to-expressrc.json"), JSON.stringify(config));

    const result = loadConfig(tmpDir);
    assert.deepEqual(result, config);
  });

  it("loads partial config", () => {
    const partialDir = join(tmpDir, "partial");
    mkdirSync(partialDir, { recursive: true });
    writeFileSync(join(partialDir, ".openapi-to-expressrc.json"), JSON.stringify({ input: "spec.json", output: "out" }));

    const result = loadConfig(partialDir);
    assert.equal(result!.input, "spec.json");
    assert.equal(result!.output, "out");
    assert.equal(result!["types-dir"], undefined);
  });

  it("throws on invalid JSON", () => {
    const badDir = join(tmpDir, "bad");
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, ".openapi-to-expressrc.json"), "not json{{{");

    assert.throws(() => loadConfig(badDir), { message: /Failed to parse/ });
  });
});
