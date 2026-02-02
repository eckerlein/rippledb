#!/usr/bin/env tsx
/**
 * Run TypeScript extended diagnostics for all packages
 *
 * Usage:
 *   pnpm tsx scripts/src/diagnose-all-packages.ts
 */

import { execSync } from "child_process";
import { readdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "../..");
const PACKAGES_DIR = join(ROOT, "packages");

interface PackageDiagnostics {
  name: string;
  files: number;
  lines: number;
  time: number;
  errors: number;
}

function getPackages(): string[] {
  const packages: string[] = [];
  try {
    const entries = readdirSync(PACKAGES_DIR);
    for (const entry of entries) {
      const path = join(PACKAGES_DIR, entry);
      if (statSync(path).isDirectory()) {
        const tsconfigPath = join(path, "tsconfig.json");
        try {
          statSync(tsconfigPath);
          packages.push(entry);
        } catch {
          // No tsconfig, skip
        }
      }
    }
  } catch (error) {
    console.error("Error reading packages directory:", error);
  }
  return packages.sort();
}

function runDiagnostics(packageName: string): PackageDiagnostics | null {
  const packagePath = join(PACKAGES_DIR, packageName);
  const tsconfigPath = join(packagePath, "tsconfig.json");

  try {
    const output = execSync(
      `pnpm tsc --noEmit --extendedDiagnostics -p ${tsconfigPath}`,
      {
        cwd: ROOT,
        encoding: "utf-8",
        stdio: "pipe",
      },
    );

    // Parse extended diagnostics output
    const filesMatch = output.match(/Files:\s+(\d+)/);
    const linesMatch = output.match(/Lines of TypeScript:\s+(\d+)/);
    const totalTimeMatch = output.match(/Total time:\s+([\d.]+)s/);
    const parseTimeMatch = output.match(/Parse time:\s+([\d.]+)s/);
    const bindTimeMatch = output.match(/Bind time:\s+([\d.]+)s/);
    const programTimeMatch = output.match(/Program time:\s+([\d.]+)s/);
    const errorsMatch = output.match(/Errors:\s+(\d+)/);

    return {
      name: packageName,
      files: filesMatch ? parseInt(filesMatch[1], 10) : 0,
      lines: linesMatch ? parseInt(linesMatch[1], 10) : 0,
      time: totalTimeMatch ? parseFloat(totalTimeMatch[1]) * 1000 : 0, // Convert to ms
      errors: errorsMatch ? parseInt(errorsMatch[1], 10) : 0,
    };
  } catch (error: unknown) {
    // Try to extract diagnostics even if there are errors
    const errorOutput = error instanceof Error && "stdout" in error
      ? String((error as { stdout?: string; }).stdout)
      : String(error);

    const filesMatch = errorOutput.match(/Files:\s+(\d+)/);
    const linesMatch = errorOutput.match(/Lines of TypeScript:\s+(\d+)/);
    const totalTimeMatch = errorOutput.match(/Total time:\s+([\d.]+)s/);
    const errorsMatch = errorOutput.match(/Errors:\s+(\d+)/);

    if (filesMatch || linesMatch || totalTimeMatch) {
      return {
        name: packageName,
        files: filesMatch ? parseInt(filesMatch[1], 10) : 0,
        lines: linesMatch ? parseInt(linesMatch[1], 10) : 0,
        time: totalTimeMatch ? parseFloat(totalTimeMatch[1]) * 1000 : 0,
        errors: errorsMatch ? parseInt(errorsMatch[1], 10) : 0,
      };
    }

    console.error(`❌ Failed to get diagnostics for ${packageName}`);
    return null;
  }
}

console.log("🔍 TypeScript Extended Diagnostics for All Packages\n");
console.log("=".repeat(80));

const packages = getPackages();
const results: PackageDiagnostics[] = [];

for (const pkg of packages) {
  process.stdout.write(`\n📦 ${pkg}... `);
  const result = runDiagnostics(pkg);
  if (result) {
    results.push(result);
    console.log(
      `✅ ${
        result.time.toFixed(2)
      }ms (${result.files} files, ${result.errors} errors)`,
    );
  } else {
    console.log("❌ Failed");
  }
}

// Summary
console.log("\n" + "=".repeat(80));
console.log("\n📊 Summary\n");

if (results.length === 0) {
  console.log("No results to display.");
  process.exit(1);
}

// Sort by time (slowest first)
results.sort((a, b) => b.time - a.time);

console.log("Slowest packages (by compilation time):\n");
console.log(
  "Package".padEnd(30)
    + "Time (ms)".padEnd(12)
    + "Files".padEnd(8)
    + "Lines".padEnd(10)
    + "Errors",
);
console.log("-".repeat(80));

for (const result of results) {
  const timeStr = result.time.toFixed(2);
  const filesStr = result.files.toString();
  const linesStr = result.lines.toLocaleString();
  const errorsStr = result.errors > 0 ? `⚠️  ${result.errors}` : "✓";

  console.log(
    result.name.padEnd(30)
      + timeStr.padEnd(12)
      + filesStr.padEnd(8)
      + linesStr.padEnd(10)
      + errorsStr,
  );
}

const totalTime = results.reduce((sum, r) => sum + r.time, 0);
const totalFiles = results.reduce((sum, r) => sum + r.files, 0);
const totalLines = results.reduce((sum, r) => sum + r.lines, 0);
const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);

console.log("-".repeat(80));
console.log(
  "TOTAL".padEnd(30)
    + totalTime.toFixed(2).padEnd(12)
    + totalFiles.toString().padEnd(8)
    + totalLines.toLocaleString().padEnd(10)
    + (totalErrors > 0 ? `⚠️  ${totalErrors}` : "✓"),
);

console.log("\n💡 Focus optimization efforts on the slowest packages above.");
