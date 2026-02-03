#!/usr/bin/env tsx
/**
 * TypeScript Performance Profiling Script
 *
 * Uses TypeScript's built-in performance tracing to identify bottlenecks
 *
 * Usage:
 *   pnpm tsx scripts/src/profile-tsc-performance.ts
 */

import { execSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "../..");
const TRACE_DIR = join(ROOT, ".tsc-trace");

console.log("🔍 TypeScript Performance Profiling\n");
console.log("=".repeat(50));

// Clean up old traces
if (TRACE_DIR) {
  try {
    rmSync(TRACE_DIR, { recursive: true, force: true });
  } catch {
    // Ignore
  }
}
mkdirSync(TRACE_DIR, { recursive: true });

console.log("\n📊 Running TypeScript with extended diagnostics...\n");

try {
  execSync("pnpm tsc --noEmit --extendedDiagnostics", {
    cwd: ROOT,
    stdio: "inherit",
  });
} catch {
  // Errors are expected, we just want the diagnostics
}

console.log("\n" + "=".repeat(50));
console.log("\n💡 Next steps:");
console.log("1. Check the output above for timing breakdown");
console.log("2. Look for files/types that take longest to check");
console.log("3. Consider simplifying complex conditional types");
console.log("\n📁 Trace files (if generated) are in:", TRACE_DIR);
