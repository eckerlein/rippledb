#!/usr/bin/env tsx
/**
 * TypeScript Performance Diagnostics and Checking
 *
 * Usage:
 *   pnpm tsx scripts/src/tsc-performance.ts          # Run diagnostics (default)
 *   pnpm tsx scripts/src/tsc-performance.ts --check  # Check against limits (CI mode)
 */

import { execSync } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "../..");
const PACKAGES_DIR = join(ROOT, "packages");
const LIMITS_PATH = join(ROOT, ".github/tsc-performance-limits.json");

interface PackageDiagnostics {
  name: string;
  files: number;
  lines: number;
  time: number;
  errors: number;
}

interface PerformanceLimits {
  totalMax: number;
  packages: Record<string, number>;
  headroomFailThreshold: number;
  headroomWarningThreshold: number;
}

// Shared functions
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

function renderSummaryTable(results: PackageDiagnostics[]): void {
  // Sort by time (slowest first)
  const sorted = [...results].sort((a, b) => b.time - a.time);

  console.log("Slowest packages (by compilation time):\n");
  console.log(
    "Package".padEnd(30)
      + "Time (ms)".padEnd(12)
      + "Files".padEnd(8)
      + "Lines".padEnd(10)
      + "Errors",
  );
  console.log("-".repeat(80));

  for (const result of sorted) {
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
}

// Track table height for live updates
let lastTableHeight = 0;

function renderLiveTable(results: PackageDiagnostics[]): void {
  // Sort by time (slowest first)
  const sorted = [...results].sort((a, b) => b.time - a.time);

  // Calculate current table height: header (2 lines) + rows + separator + total + empty line
  const currentHeight = sorted.length + 5;

  // Clear previous table if it exists
  if (lastTableHeight > 0) {
    process.stdout.write(`\x1b[${lastTableHeight}A`); // Move cursor up
    process.stdout.write("\x1b[0J"); // Clear from cursor to end of screen
  }

  // Update tracked height
  lastTableHeight = currentHeight;

  // Draw table
  process.stdout.write("Slowest packages (by compilation time):\n");
  process.stdout.write(
    "Package".padEnd(30)
      + "Time (ms)".padEnd(12)
      + "Files".padEnd(8)
      + "Lines".padEnd(10)
      + "Errors"
      + "\n",
  );
  process.stdout.write("-".repeat(80) + "\n");

  for (const result of sorted) {
    const timeStr = result.time.toFixed(2);
    const filesStr = result.files.toString();
    const linesStr = result.lines.toLocaleString();
    const errorsStr = result.errors > 0 ? `⚠️  ${result.errors}` : "✓";

    process.stdout.write(
      result.name.padEnd(30)
        + timeStr.padEnd(12)
        + filesStr.padEnd(8)
        + linesStr.padEnd(10)
        + errorsStr
        + "\n",
    );
  }

  const totalTime = results.reduce((sum, r) => sum + r.time, 0);
  const totalFiles = results.reduce((sum, r) => sum + r.files, 0);
  const totalLines = results.reduce((sum, r) => sum + r.lines, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);

  process.stdout.write("-".repeat(80) + "\n");
  process.stdout.write(
    "TOTAL".padEnd(30)
      + totalTime.toFixed(2).padEnd(12)
      + totalFiles.toString().padEnd(8)
      + totalLines.toLocaleString().padEnd(10)
      + (totalErrors > 0 ? `⚠️  ${totalErrors}` : "✓")
      + "\n",
  );
}

// Check mode functions
function loadLimits(): PerformanceLimits {
  if (!existsSync(LIMITS_PATH)) {
    throw new Error(
      `Performance limits file not found: ${LIMITS_PATH}\n`
        + "Create .github/tsc-performance-limits.json with package max times.",
    );
  }
  const raw = JSON.parse(readFileSync(LIMITS_PATH, "utf-8"));
  return {
    headroomFailThreshold: raw.headroomFailThreshold ?? 0.4,
    headroomWarningThreshold: raw.headroomWarningThreshold ?? 0.5,
    ...raw,
  };
}

function checkPerformance(
  results: PackageDiagnostics[],
  limits: PerformanceLimits,
): {
  passed: boolean;
  errors: string[];
  warnings: string[];
} {
  const totalTime = results.reduce((sum, r) => sum + r.time, 0);
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check total time
  if (totalTime > limits.totalMax) {
    errors.push(
      `Total compilation time ${
        totalTime.toFixed(2)
      }ms exceeds max ${limits.totalMax}ms (+${
        ((totalTime / limits.totalMax - 1) * 100).toFixed(1)
      }%)`,
    );
  } else if (totalTime < limits.totalMax * limits.headroomFailThreshold) {
    errors.push(
      `Total time ${totalTime.toFixed(2)}ms is ${
        ((1 - totalTime / limits.totalMax) * 100).toFixed(1)
      }% below max ${limits.totalMax}ms. `
        + `Limit is too high - reduce totalMax to keep limits realistic.`,
    );
  } else if (totalTime < limits.totalMax * limits.headroomWarningThreshold) {
    warnings.push(
      `Total time ${totalTime.toFixed(2)}ms is ${
        ((1 - totalTime / limits.totalMax) * 100).toFixed(1)
      }% below max. Consider lowering totalMax.`,
    );
  }

  // Check each package
  for (const pkg of results) {
    const max = limits.packages[pkg.name];
    if (!max) {
      warnings.push(
        `Package "${pkg.name}" has no limit defined. Current: ${
          pkg.time.toFixed(2)
        }ms`,
      );
      continue;
    }

    // Check if exceeds max
    if (pkg.time > max) {
      errors.push(
        `Package "${pkg.name}": ${
          pkg.time.toFixed(2)
        }ms exceeds max ${max}ms (+${
          ((pkg.time / max - 1) * 100).toFixed(1)
        }%)`,
      );
    } // Fail if too much headroom (limit too high)
    else if (pkg.time < max * limits.headroomFailThreshold) {
      errors.push(
        `Package "${pkg.name}": ${pkg.time.toFixed(2)}ms is ${
          ((1 - pkg.time / max) * 100).toFixed(1)
        }% below max ${max}ms. `
          + `Limit is too high - reduce limit to keep it realistic (suggest: ${
            Math.ceil(pkg.time * 1.3)
          }ms)`,
      );
    } // Warn if significant headroom
    else if (pkg.time < max * limits.headroomWarningThreshold) {
      warnings.push(
        `Package "${pkg.name}": ${pkg.time.toFixed(2)}ms is ${
          ((1 - pkg.time / max) * 100).toFixed(1)
        }% below max ${max}ms. Consider lowering limit to ${
          Math.ceil(pkg.time * 1.3)
        }ms`,
      );
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

// Main execution
const isCheckMode = process.argv.includes("--check");
const isTTY = process.stdout.isTTY && process.stderr.isTTY;
const useLiveTable = isTTY && !process.env.CI; // Don't use live table in CI even if TTY

if (isCheckMode) {
  // Check mode: run diagnostics and check against limits
  console.log("🔍 TypeScript Performance Check\n");
  console.log("=".repeat(80));

  const limits = loadLimits();
  const packages = getPackages();
  const results: PackageDiagnostics[] = [];

  // Initialize live table if enabled
  if (useLiveTable) {
    console.log("\n📊 Summary (updating live)\n");
    renderLiveTable([]); // Initial empty table
  }

  // Run diagnostics with live updates
  for (const pkg of packages) {
    if (!useLiveTable) {
      process.stdout.write(`\n📦 ${pkg}... `);
    }
    const result = runDiagnostics(pkg);
    if (result) {
      results.push(result);
      if (useLiveTable) {
        // Update live table
        renderLiveTable(results);
      } else {
        console.log(
          `✅ ${
            result.time.toFixed(2)
          }ms (${result.files} files, ${result.errors} errors)`,
        );
      }
    } else {
      if (!useLiveTable) {
        console.log("❌ Failed");
      }
    }
  }

  // Show final summary table (if not using live updates, or to finalize live table)
  if (!useLiveTable) {
    console.log("\n" + "=".repeat(80));
    console.log("\n📊 Summary\n");
    renderSummaryTable(results);
  } else {
    // Finalize live table with separator
    console.log("\n" + "=".repeat(80));
  }

  // Now check against limits
  console.log("\n" + "=".repeat(80));
  const checkResult = checkPerformance(results, limits);

  if (checkResult.errors.length > 0) {
    console.error("\n❌ Performance Check Failed:\n");
    for (const error of checkResult.errors) {
      console.error(`  • ${error}`);
    }
  }

  if (checkResult.warnings.length > 0) {
    console.warn("\n⚠️  Warnings:\n");
    for (const warning of checkResult.warnings) {
      console.warn(`  • ${warning}`);
    }
  }

  if (checkResult.passed) {
    console.log("\n✅ All performance checks passed!");
    process.exit(0);
  } else {
    console.error("\n💡 Consider:");
    console.error("  - Review recent type changes");
    console.error("  - Check for new dependencies");
    console.error("  - Run 'pnpm perf:find-types' to identify slow types");
    console.error(
      "  - Update limits in .github/tsc-performance-limits.json if appropriate",
    );
    process.exit(1);
  }
} else {
  // Diagnose mode: run diagnostics and show summary table
  console.log("🔍 TypeScript Extended Diagnostics for All Packages\n");
  console.log("=".repeat(80));

  const packages = getPackages();
  const results: PackageDiagnostics[] = [];

  // Initialize live table if enabled
  if (useLiveTable) {
    console.log("\n📊 Summary (updating live)\n");
    renderLiveTable([]); // Initial empty table
  }

  for (const pkg of packages) {
    if (!useLiveTable) {
      process.stdout.write(`\n📦 ${pkg}... `);
    }
    const result = runDiagnostics(pkg);
    if (result) {
      results.push(result);
      if (useLiveTable) {
        // Update live table
        renderLiveTable(results);
      } else {
        console.log(
          `✅ ${
            result.time.toFixed(2)
          }ms (${result.files} files, ${result.errors} errors)`,
        );
      }
    } else {
      if (!useLiveTable) {
        console.log("❌ Failed");
      }
    }
  }

  // Summary
  if (!useLiveTable) {
    console.log("\n" + "=".repeat(80));
    console.log("\n📊 Summary\n");
  }

  if (results.length === 0) {
    console.log("No results to display.");
    process.exit(1);
  }

  if (!useLiveTable) {
    renderSummaryTable(results);
  }
  console.log("\n💡 Focus optimization efforts on the slowest packages above.");
}
