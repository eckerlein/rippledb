#!/usr/bin/env tsx
/**
 * Check TypeScript performance against per-package limits
 *
 * Checks:
 * 1. No package exceeds its max limit
 * 2. Fails if performance is too good (limit too high) - forces realistic limits
 * 3. Total time doesn't exceed totalMax
 *
 * Usage:
 *   pnpm tsx scripts/src/check-tsc-performance.ts
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

interface PerformanceLimits {
  totalMax: number;
  packages: Record<string, number>;
  headroomFailThreshold: number; // Fail if current < threshold * max (e.g., 0.4 = 40%)
  headroomWarningThreshold: number; // Warn if current < threshold * max (e.g., 0.5 = 50%)
}

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

function loadLimits(): PerformanceLimits {
  if (!existsSync(LIMITS_PATH)) {
    throw new Error(
      `Performance limits file not found: ${LIMITS_PATH}\n`
        + "Create .github/tsc-performance-limits.json with package max times.",
    );
  }
  const raw = JSON.parse(readFileSync(LIMITS_PATH, "utf-8"));
  // Set defaults for thresholds
  return {
    headroomFailThreshold: raw.headroomFailThreshold ?? 0.4, // Default: fail if < 40% of max
    headroomWarningThreshold: raw.headroomWarningThreshold ?? 0.5, // Default: warn if < 50% of max
    ...raw,
  };
}

function getPerformanceFromDiagnose(): {
  totalTime: number;
  packages: PackageDiagnostics[];
} {
  // Run perf:diagnose and parse its output to get consistent measurements
  const output = execSync("pnpm perf:diagnose", {
    cwd: ROOT,
    encoding: "utf-8",
    stdio: "pipe",
  });

  const packages: PackageDiagnostics[] = [];
  let totalTime = 0;

  // Parse the summary table output
  const lines = output.split("\n");
  let inSummary = false;

  for (const line of lines) {
    // Start parsing when we hit the summary table
    if (line.includes("Package") && line.includes("Time (ms)")) {
      inSummary = true;
      continue;
    }

    // Stop at the TOTAL line
    if (line.includes("TOTAL")) {
      const totalMatch = line.match(/TOTAL\s+([\d.]+)/);
      if (totalMatch) {
        totalTime = parseFloat(totalMatch[1]);
      }
      break;
    }

    // Parse package lines: "package-name                   460.00      266     987       ✓"
    if (inSummary && line.trim() && !line.includes("-".repeat(80))) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4 && !isNaN(parseFloat(parts[1]))) {
        packages.push({
          name: parts[0],
          time: parseFloat(parts[1]),
          files: parseInt(parts[2], 10),
          lines: parseInt(parts[3].replace(/,/g, ""), 10) || 0,
          errors: line.includes("⚠️") ? 1 : 0,
        });
      }
    }
  }

  return { totalTime, packages };
}

function checkPerformance(): {
  passed: boolean;
  errors: string[];
  warnings: string[];
} {
  const limits = loadLimits();

  // Use perf:diagnose output for consistent measurements
  const { totalTime, packages: results } = getPerformanceFromDiagnose();

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
const result = checkPerformance();

console.log("🔍 TypeScript Performance Check\n");
console.log("=".repeat(80));

if (result.errors.length > 0) {
  console.error("\n❌ Performance Check Failed:\n");
  for (const error of result.errors) {
    console.error(`  • ${error}`);
  }
}

if (result.warnings.length > 0) {
  console.warn("\n⚠️  Warnings:\n");
  for (const warning of result.warnings) {
    console.warn(`  • ${warning}`);
  }
}

if (result.passed) {
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
