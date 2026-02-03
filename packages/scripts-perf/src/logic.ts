/**
 * Core Business Logic - UI-independent functions
 */

import { execSync } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Go up from dist/logic.js (packages/scripts-perf/dist) to root
// dist -> scripts-perf -> packages -> root (3 levels up)
export const ROOT = join(__dirname, "../../..");
export const PACKAGES_DIR = join(ROOT, "packages");
export const LIMITS_PATH = join(ROOT, ".github/tsc-performance-limits.json");

export interface PackageDiagnostics {
  name: string;
  files: number;
  lines: number;
  time: number;
  errors: number;
  minTime?: number;
  maxTime?: number;
  runs?: number;
}

export interface PerformanceLimits {
  totalMax: number;
  packages: Record<string, number>;
  headroomFailThreshold: number;
  headroomWarningThreshold: number;
}

export interface CheckResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

export interface AveragedDiagnostics extends PackageDiagnostics {
  minTime: number;
  maxTime: number;
  runs: number;
}

export function getPackages(): string[] {
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
  } catch {
    // Ignore
  }
  return packages.sort();
}

export function runDiagnostics(packageName: string): PackageDiagnostics | null {
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

    const filesMatch = output.match(/Files:\s+(\d+)/);
    const linesMatch = output.match(/Lines of TypeScript:\s+(\d+)/);
    const totalTimeMatch = output.match(/Total time:\s+([\d.]+)s/);
    const errorsMatch = output.match(/Errors:\s+(\d+)/);

    return {
      name: packageName,
      files: filesMatch ? parseInt(filesMatch[1], 10) : 0,
      lines: linesMatch ? parseInt(linesMatch[1], 10) : 0,
      time: totalTimeMatch ? parseFloat(totalTimeMatch[1]) * 1000 : 0,
      errors: errorsMatch ? parseInt(errorsMatch[1], 10) : 0,
    };
  } catch (error: unknown) {
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
    return null;
  }
}

export async function runDiagnosticsMultiple(
  packageName: string,
  runs: number = 3,
  onProgress?: (current: number, total: number) => void,
): Promise<AveragedDiagnostics | null> {
  const results: PackageDiagnostics[] = [];

  for (let i = 0; i < runs; i++) {
    const result = runDiagnostics(packageName);
    if (!result) return null;
    results.push(result);

    // Allow UI to update between runs
    if (onProgress) {
      onProgress(i + 1, runs);
    }
    if (i < runs - 1) {
      // Small delay to allow React to render
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  const times = results.map(r => r.time);
  const avgTime = times.reduce((sum, t) => sum + t, 0) / times.length;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);

  // Use the first result for files/lines/errors (they should be the same)
  return {
    ...results[0],
    time: avgTime,
    minTime,
    maxTime,
    runs,
  };
}

export function loadLimits(): PerformanceLimits {
  if (!existsSync(LIMITS_PATH)) {
    throw new Error(`Performance limits file not found: ${LIMITS_PATH}`);
  }
  const raw = JSON.parse(readFileSync(LIMITS_PATH, "utf-8"));
  return {
    headroomFailThreshold: raw.headroomFailThreshold ?? 0.4,
    headroomWarningThreshold: raw.headroomWarningThreshold ?? 0.5,
    ...raw,
  };
}

export function getPackageStatus(
  result: PackageDiagnostics,
  limits?: PerformanceLimits,
  isCheckMode?: boolean,
  isRerunning?: boolean,
): string {
  if (isRerunning) return "🔄";
  if (result.errors > 0) return "❌";
  if (!limits) return "✅";

  const max = limits.packages[result.name];
  // In check mode, missing max is an error
  if (!max) return isCheckMode ? "❌" : "✅";

  if (result.time > max) return "❌";
  if (result.time < max * limits.headroomWarningThreshold) return "⚠️";
  return "✅";
}

export function checkPerformance(
  results: PackageDiagnostics[],
  limits: PerformanceLimits,
): CheckResult {
  const totalTime = results.reduce((sum, r) => sum + r.time, 0);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (totalTime > limits.totalMax) {
    errors.push(
      `Total compilation time ${
        totalTime.toFixed(2)
      }ms exceeds max ${limits.totalMax}ms (+${
        ((totalTime / limits.totalMax - 1) * 100).toFixed(1)
      }%)`,
    );
  }

  for (const pkg of results) {
    const max = limits.packages[pkg.name];
    if (!max) {
      errors.push(
        `Package "${pkg.name}": No performance limit defined in .github/tsc-performance-limits.json`,
      );
      continue;
    }

    if (pkg.time > max) {
      if (pkg.runs && pkg.runs > 1 && pkg.minTime && pkg.maxTime) {
        errors.push(
          `Package "${pkg.name}": avg ${pkg.time.toFixed(2)}ms (range: ${
            pkg.minTime.toFixed(2)
          }-${pkg.maxTime.toFixed(2)}ms) exceeds max ${max}ms (+${
            ((pkg.time / max - 1) * 100).toFixed(1)
          }%)`,
        );
      } else {
        errors.push(
          `Package "${pkg.name}": ${
            pkg.time.toFixed(2)
          }ms exceeds max ${max}ms (+${
            ((pkg.time / max - 1) * 100).toFixed(1)
          }%)`,
        );
      }
    } else if (pkg.time < max * limits.headroomWarningThreshold) {
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
