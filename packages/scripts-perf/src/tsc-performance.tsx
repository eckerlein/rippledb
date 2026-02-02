#!/usr/bin/env node
/**
 * TypeScript Performance Diagnostics - Pure Ink App
 *
 * This package uses ESM with top-level await support to properly handle
 * Ink's dependencies (yoga-layout uses top-level await).
 */

import { execSync } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { Box, render, Text } from "ink";
import { dirname, join } from "path";
import React, { useEffect, useState } from "react";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Go up from dist/tsc-performance.js (packages/scripts-perf/dist) to root
// dist -> scripts-perf -> packages -> root (3 levels up)
const ROOT = join(__dirname, "../../..");
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
  } catch {
    // Ignore
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

function loadLimits(): PerformanceLimits {
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

function getPackageStatus(
  result: PackageDiagnostics,
  limits?: PerformanceLimits,
  isCheckMode?: boolean,
): string {
  if (result.errors > 0) return "❌";
  if (!limits) return "✅";

  const max = limits.packages[result.name];
  // In check mode, missing max is an error
  if (!max) return isCheckMode ? "❌" : "✅";

  if (result.time > max) return "❌";
  if (result.time < max * limits.headroomWarningThreshold) return "⚠️";
  return "✅";
}

function PerformanceTable({
  results,
  limits,
  isCheckMode = false,
}: {
  results: PackageDiagnostics[];
  limits?: PerformanceLimits;
  isCheckMode?: boolean;
}) {
  const sorted = [...results].sort((a, b) => b.time - a.time);
  const hasLimits = limits !== undefined;

  const totalTime = results.reduce((sum, r) => sum + r.time, 0);
  const totalFiles = results.reduce((sum, r) => sum + r.files, 0);
  const totalLines = results.reduce((sum, r) => sum + r.lines, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);

  return (
    <Box flexDirection="column">
      <Text>Slowest packages (by compilation time):</Text>
      <Text>
        {hasLimits
          ? "  Package".padEnd(32)
            + "Time (ms)".padEnd(12)
            + "Max (ms)".padEnd(12)
            + "Files".padEnd(8)
            + "Lines".padEnd(10)
            + "Errors"
          : "Package".padEnd(30)
            + "Time (ms)".padEnd(12)
            + "Files".padEnd(8)
            + "Lines".padEnd(10)
            + "Errors"}
      </Text>
      <Text>{"-".repeat(hasLimits ? 94 : 82)}</Text>
      {sorted.map(result => {
        const status = getPackageStatus(result, limits, isCheckMode);
        const max = limits?.packages[result.name];
        const maxStr = max ? max.toString() : "-";

        return (
          <Text key={result.name}>
            {hasLimits
              ? `${status} ${result.name}`.padEnd(32)
                + result.time.toFixed(2).padEnd(12)
                + maxStr.padEnd(12)
                + result.files.toString().padEnd(8)
                + result.lines.toLocaleString().padEnd(10)
                + (result.errors > 0 ? `⚠️  ${result.errors}` : "✓")
              : `${status} ${result.name}`.padEnd(30)
                + result.time.toFixed(2).padEnd(12)
                + result.files.toString().padEnd(8)
                + result.lines.toLocaleString().padEnd(10)
                + (result.errors > 0 ? `⚠️  ${result.errors}` : "✓")}
          </Text>
        );
      })}
      <Text>{"-".repeat(hasLimits ? 94 : 82)}</Text>
      <Text>
        {hasLimits
          ? "  TOTAL".padEnd(32)
            + totalTime.toFixed(2).padEnd(12)
            + (limits?.totalMax ? limits.totalMax.toString() : "-").padEnd(12)
            + totalFiles.toString().padEnd(8)
            + totalLines.toLocaleString().padEnd(10)
            + (totalErrors > 0 ? `⚠️  ${totalErrors}` : "✓")
          : "TOTAL".padEnd(30)
            + totalTime.toFixed(2).padEnd(12)
            + totalFiles.toString().padEnd(8)
            + totalLines.toLocaleString().padEnd(10)
            + (totalErrors > 0 ? `⚠️  ${totalErrors}` : "✓")}
      </Text>
    </Box>
  );
}

function App({ isCheckMode }: { isCheckMode: boolean; }) {
  const [results, setResults] = useState<PackageDiagnostics[]>([]);
  const [limits, setLimits] = useState<PerformanceLimits | null>(null);
  const [checkResult, setCheckResult] = useState<
    {
      passed: boolean;
      errors: string[];
      warnings: string[];
    } | null
  >(null);

  // Load limits once on mount (not in effect to avoid loop)
  useEffect(() => {
    if (isCheckMode) {
      try {
        setLimits(loadLimits());
      } catch {
        // Will show error in UI
      }
    }
  }, [isCheckMode]);

  // Main execution effect - only depends on isCheckMode and limits being loaded
  useEffect(() => {
    // Don't run if limits haven't loaded yet in check mode
    if (isCheckMode && limits === null) {
      return;
    }

    const packages = getPackages();
    let currentResults: PackageDiagnostics[] = [];
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let isCancelled = false;

    const runNext = (index: number) => {
      if (isCancelled || index >= packages.length) {
        if (!isCancelled && isCheckMode && limits) {
          // Check performance
          const totalTime = currentResults.reduce((sum, r) => sum + r.time, 0);
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

          for (const pkg of currentResults) {
            const max = limits.packages[pkg.name];
            if (!max) {
              errors.push(
                `Package "${pkg.name}": No performance limit defined in .github/tsc-performance-limits.json`,
              );
              continue;
            }

            if (pkg.time > max) {
              errors.push(
                `Package "${pkg.name}": ${
                  pkg.time.toFixed(2)
                }ms exceeds max ${max}ms (+${
                  ((pkg.time / max - 1) * 100).toFixed(1)
                }%)`,
              );
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

          setCheckResult({
            passed: errors.length === 0,
            errors,
            warnings,
          });
        }
        return;
      }

      if (isCancelled) return;

      const result = runDiagnostics(packages[index]);
      if (result && !isCancelled) {
        currentResults = [...currentResults, result];
        setResults([...currentResults]);
      }

      if (!isCancelled) {
        // Small delay to allow UI to update
        timeoutId = setTimeout(() => runNext(index + 1), 10);
      }
    };

    runNext(0);

    // Cleanup function
    return () => {
      isCancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isCheckMode, limits]);

  if (isCheckMode && !limits) {
    return (
      <Box flexDirection="column">
        <Text color="red">
          Error: Performance limits file not found. Create
          .github/tsc-performance-limits.json
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text>
        {isCheckMode
          ? "🔍 TypeScript Performance Check"
          : "🔍 TypeScript Extended Diagnostics for All Packages"}
      </Text>
      <Text></Text>
      <Text>{"=".repeat(80)}</Text>
      <Text></Text>
      <Text>📊 Summary (updating live)</Text>
      <Text></Text>
      {results.length > 0 && (
        <PerformanceTable
          results={results}
          limits={limits || undefined}
          isCheckMode={isCheckMode}
        />
      )}
      {checkResult && (
        <>
          <Text></Text>
          <Text>{"=".repeat(80)}</Text>
          <Text></Text>
          <Text>{"=".repeat(80)}</Text>
          <Text></Text>
          {checkResult.errors.length > 0 && (
            <Box flexDirection="column">
              <Text color="red">❌ Performance Check Failed:</Text>
              {checkResult.errors.map((error, i) => (
                <Text color="red" key={i}>
                  {"  • " + error}
                </Text>
              ))}
            </Box>
          )}
          {checkResult.warnings.length > 0 && (
            <Box flexDirection="column">
              <Text color="yellow">⚠️ Warnings:</Text>
              {checkResult.warnings.map((warning, i) => (
                <Text color="yellow" key={i}>
                  {"  • " + warning}
                </Text>
              ))}
            </Box>
          )}
          {checkResult.passed && (
            <Text color="green">✅ All performance checks passed!</Text>
          )}
          {!checkResult.passed && (
            <Box flexDirection="column">
              <Text>💡 Consider:</Text>
              <Text>{"  - Review recent type changes"}</Text>
              <Text>{"  - Check for new dependencies"}</Text>
              <Text>
                {"  - Run 'pnpm perf:find-types' to identify slow types"}
              </Text>
              <Text>
                {"  - Update limits in .github/tsc-performance-limits.json if appropriate"}
              </Text>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

const isCheckMode = process.argv.includes("--check");
const isTTY = process.stdout.isTTY && process.stderr.isTTY;

if (isTTY && !process.env.CI) {
  // Use Ink for interactive terminal
  const instance = render(
    React.createElement(App, { isCheckMode }),
  );

  // Handle Ctrl+C properly
  let isExiting = false;
  const handleExit = () => {
    if (isExiting) {
      process.exit(1);
      return;
    }
    isExiting = true;
    instance.unmount();
    instance.clear();
    process.exit(0);
  };

  process.on("SIGINT", handleExit);
  process.on("SIGTERM", handleExit);

  instance.waitUntilExit().then(() => {
    if (!isExiting) {
      process.exit(0);
    }
  }).catch(() => {
    if (!isExiting) {
      process.exit(1);
    }
  });
} else {
  // Non-TTY or CI - use simple console output
  console.error("Ink requires a TTY. Use a terminal to run this script.");
  process.exit(1);
}
