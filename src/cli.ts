#!/usr/bin/env node

/**
 * CLI for openapi-to-express
 *
 * Usage:
 *   npx openapi-to-express -i openapi.json -o src
 *   npx openapi-to-express                          (reads from .openapi-to-expressrc.json)
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { generate } from "./generate.js";
import { loadConfig } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));

const { values } = parseArgs({
  options: {
    input: { type: "string", short: "i" },
    output: { type: "string", short: "o" },
    "types-dir": { type: "string" },
    "controllers-dir": { type: "string" },
    "routes-dir": { type: "string" },
    "dry-run": { type: "boolean" },
    validate: { type: "boolean" },
    strict: { type: "boolean" },
    watch: { type: "boolean", short: "w" },
    version: { type: "boolean", short: "v" },
    help: { type: "boolean", short: "h" },
  },
  strict: true,
});

if (values.version) {
  console.log(pkg.version);
  process.exit(0);
}

if (values.help) {
  console.log(`
openapi-to-express v${pkg.version} — Generate server code from OpenAPI specs

Usage:
  openapi-to-express --input <spec> --output <dir> [options]
  openapi-to-express                                          (reads from .openapi-to-expressrc.json)

Required (unless provided in .openapi-to-expressrc.json):
  -i, --input <value>          OpenAPI specification — path (.json/.yaml/.yml), URL, or string content
  -o, --output <value>         Output directory (e.g. "src")

Optional:
  --types-dir <name>           Folder name for types (default: "types")
  --controllers-dir <name>     Folder name for controller interfaces (default: "controllers")
  --routes-dir <name>          Folder name for routes (default: "routes")
  --validate                   Check codegen readiness (errors only)
  --strict                     With --validate: also show warnings
  --dry-run                    Show what would be generated without writing files
  -w, --watch                  Watch the spec file and regenerate on changes
  -v, --version                Output the version number
  -h, --help                   Show this help message

Config file (.openapi-to-expressrc.json):
  {
    "input": "openapi.json",
    "output": "src",
    "types-dir": "types",
    "controllers-dir": "controllers",
    "routes-dir": "routes"
  }

  CLI flags override config file values.

Examples:
  npx openapi-to-express -i openapi.json -o src
  npx openapi-to-express -i openapi.json -o src --types-dir models
  npx openapi-to-express
`);
  process.exit(0);
}

// Load config file, merge with CLI flags (CLI wins)
const config = loadConfig() ?? {};

const input = values.input ?? config.input;
const output = values.output ?? config.output;

// Validate mode — only needs input
if (values.validate) {
  if (!input) {
    console.error("Error: --input is required for validation.\n");
    console.error("Usage: openapi-to-express --input openapi.json --validate");
    process.exit(1);
  }

  const mode = values.strict ? "strict" : "standard";
  const { resolveInput } = await import("./generate.js");
  const { validateSpec, formatValidationReport } = await import("./validator.js");

  try {
    const spec = await resolveInput(input);
    const result = validateSpec(spec);
    console.log(formatValidationReport(result, mode));
    process.exit(result.issues.some((i: any) => i.level === "error") ? 1 : 0);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

if (!input || !output) {
  console.error("Error: --input and --output are required (via CLI flags or .openapi-to-expressrc.json).\n");
  console.error("Usage: openapi-to-express --input openapi.json --output src");
  console.error("Run with --help for more info.");
  process.exit(1);
}

const typesDir = values["types-dir"] ?? config["types-dir"];
const controllersDir = values["controllers-dir"] ?? config["controllers-dir"];
const routesDir = values["routes-dir"] ?? config["routes-dir"];

const genOptions = {
  input,
  output,
  dryRun: values["dry-run"] ?? false,
  dirs: {
    ...(typesDir && { types: typesDir }),
    ...(controllersDir && { controllers: controllersDir }),
    ...(routesDir && { routes: routesDir }),
  },
};

try {
  await generate(genOptions);
} catch (err: any) {
  console.error(`Error: ${err.message}`);
  if (!values.watch) process.exit(1);
}

if (values.watch) {
  const { watch: fsWatch } = await import("node:fs");
  const specPath = resolve(input);

  console.log(`\nWatching ${specPath} for changes...\n`);

  let debounce: ReturnType<typeof setTimeout> | null = null;
  fsWatch(specPath, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      console.log(`\n--- ${new Date().toLocaleTimeString()} — spec changed, regenerating ---\n`);
      try {
        await generate(genOptions);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
      }
    }, 300);
  });
}
