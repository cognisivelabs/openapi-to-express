/**
 * Loads configuration from .openapi-to-expressrc.json in the current working directory.
 * Returns null if no config file is found.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CONFIG_FILE = ".openapi-to-expressrc.json";

export interface ConfigFile {
  input?: string;
  output?: string;
  "types-dir"?: string;
  "controllers-dir"?: string;
  "routes-dir"?: string;
}

export function loadConfig(cwd: string = process.cwd()): ConfigFile | null {
  const configPath = join(cwd, CONFIG_FILE);

  if (!existsSync(configPath)) return null;

  try {
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as ConfigFile;
  } catch (err: any) {
    throw new Error(`Failed to parse ${CONFIG_FILE}: ${err.message}`);
  }
}
