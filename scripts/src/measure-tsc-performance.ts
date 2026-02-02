#!/usr/bin/env tsx
/**
 * Script to measure TypeScript compilation performance
 *
 * Usage:
 *   pnpm tsx scripts/src/measure-tsc-performance.ts
 *
 * This will:
 * 1. Measure full type check time
 * 2. Measure incremental type check time (after a small change)
 * 3. Report memory usage
 */

import { execSync } from "child_process";
import { unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

function measureTime(label: string, fn: () => void): number {
  const start = process.hrtime.bigint();
  fn();
  const end = process.hrtime.bigint();
  const ms = Number(end - start) / 1_000_000;
  console.log(`⏱️  ${label}: ${ms.toFixed(2)}ms`);
  return ms;
}

function getMemoryUsage(): {
  heapUsed: number;
  heapTotal: number;
  rss: number;
} {
  const usage = process.memoryUsage();
  return {
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
    rss: Math.round(usage.rss / 1024 / 1024),
  };
}

function formatMemory(mb: number): string {
  return `${mb}MB`;
}

console.log("🔍 TypeScript Performance Measurement\n");
console.log("=".repeat(50));

// Get initial memory
const initialMemory = getMemoryUsage();
console.log(`\n📊 Initial Memory:`);
console.log(`   Heap Used: ${formatMemory(initialMemory.heapUsed)}`);
console.log(`   Heap Total: ${formatMemory(initialMemory.heapTotal)}`);
console.log(`   RSS: ${formatMemory(initialMemory.rss)}`);

// Test 1: Full type check (cold start)
console.log("\n🧪 Test 1: Full Type Check (Cold Start)");
const fullCheckTime = measureTime("Full type check", () => {
  try {
    execSync("pnpm tsc --noEmit", {
      cwd: ROOT,
      stdio: "pipe",
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    // Type errors are expected, we just want to measure time
  }
});

// Test 2: Check with project references
console.log("\n🧪 Test 2: Type Check with Project References");
const projectRefTime = measureTime("Type check with project refs", () => {
  try {
    execSync("pnpm tsc --build --force", {
      cwd: ROOT,
      stdio: "pipe",
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    // Errors are expected
  }
});

// Test 3: Incremental check (simulate a small change)
console.log("\n🧪 Test 3: Incremental Type Check");
// Create a temporary file to trigger incremental check
const testFile = join(ROOT, "packages/core/src/.test-temp.ts");
writeFileSync(testFile, "export const test = 1;\n");

const incrementalTime = measureTime("Incremental type check", () => {
  try {
    execSync("pnpm tsc --noEmit", {
      cwd: ROOT,
      stdio: "pipe",
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    // Errors are expected
  }
});

// Clean up
unlinkSync(testFile);

// Test 4: Count type-checked files
console.log("\n🧪 Test 4: Counting TypeScript Files");
const countFiles = (dir: string): number => {
  let count = 0;
  try {
    const result = execSync(
      `find ${dir} -name "*.ts" -o -name "*.tsx" | grep -v node_modules | grep -v dist | wc -l`,
      { encoding: "utf-8", cwd: ROOT },
    );
    count = parseInt(result.trim(), 10);
  } catch {
    // Fallback
  }
  return count;
};

const fileCount = countFiles(ROOT);
console.log(`📁 TypeScript files: ${fileCount}`);

// Final memory
const finalMemory = getMemoryUsage();
console.log(`\n📊 Final Memory:`);
console.log(`   Heap Used: ${formatMemory(finalMemory.heapUsed)}`);
console.log(`   Heap Total: ${formatMemory(finalMemory.heapTotal)}`);
console.log(`   RSS: ${formatMemory(finalMemory.rss)}`);

// Summary
console.log("\n" + "=".repeat(50));
console.log("📈 Summary");
console.log("=".repeat(50));
console.log(`Full type check:        ${fullCheckTime.toFixed(2)}ms`);
console.log(`Project refs check:     ${projectRefTime.toFixed(2)}ms`);
console.log(`Incremental check:      ${incrementalTime.toFixed(2)}ms`);
console.log(`TypeScript files:       ${fileCount}`);
console.log(
  `Memory increase:       ${formatMemory(finalMemory.rss - initialMemory.rss)}`,
);

if (incrementalTime < fullCheckTime * 0.5) {
  console.log("\n✅ Incremental builds are working well!");
} else {
  console.log("\n⚠️  Incremental builds may not be optimized");
}
