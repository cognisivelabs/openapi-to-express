/**
 * Enterprise spec integration tests.
 *
 * These tests download real-world OpenAPI specs and validate that
 * the generator produces output without errors. They require network
 * access and are slower than unit tests.
 *
 * Run with: npm run test:enterprise
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generate, resolveInput } from "../../src/generate.js";
import { validateSpec } from "../../src/validator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, ".enterprise-output");

function cleanup() {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
}

const SPECS = [
  {
    name: "Petstore",
    url: "https://petstore3.swagger.io/api/v3/openapi.json",
  },
  {
    name: "Stripe",
    url: "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
  },
  {
    name: "Twilio",
    url: "https://raw.githubusercontent.com/twilio/twilio-oai/main/spec/json/twilio_api_v2010.json",
  },
  {
    name: "Slack",
    url: "https://raw.githubusercontent.com/slackapi/slack-api-specs/master/web-api/slack_web_openapi_v2.json",
  },
  {
    name: "Kubernetes",
    url: "https://raw.githubusercontent.com/kubernetes/kubernetes/master/api/openapi-spec/v3/api__v1_openapi.json",
  },
  {
    name: "GitHub",
    url: "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json",
  },
];

for (const spec of SPECS) {
  describe(`Enterprise: ${spec.name}`, () => {
    before(cleanup);
    after(cleanup);

    it(`generates files from ${spec.name} spec without errors`, async () => {
      await generate({ input: spec.url, output: outDir });

      assert.ok(existsSync(join(outDir, "types")));
      assert.ok(existsSync(join(outDir, "controllers")));
      assert.ok(existsSync(join(outDir, "routes")));
    });

    it(`validates ${spec.name} spec`, async () => {
      const specData = await resolveInput(spec.url);
      const result = validateSpec(specData);

      assert.ok(result.operationCount > 0, "Should have operations");
    });
  });
}
