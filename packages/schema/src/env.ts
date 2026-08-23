import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

let loaded = false;

/**
 * Load `.env` into process.env WITHOUT overriding already-set variables
 * (so an inline `DATABASE_URL=…` or CI secrets always win over the file).
 * Searches, in precedence order: the current working directory, the repo
 * root, then the repo's parent directory — the founder's `.env` may live one
 * level above the repo. Idempotent; call it first thing in every entrypoint.
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const here = path.dirname(fileURLToPath(import.meta.url)); // packages/schema/src
  const repoRoot = path.resolve(here, "../../.."); // -> repo root
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(repoRoot, ".env"),
    path.join(repoRoot, "..", ".env"),
  ];
  for (const file of candidates) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue; // not present here; try the next location
    }
    const parsed = parseEnv(content);
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
}
