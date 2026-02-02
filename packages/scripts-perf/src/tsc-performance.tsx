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
  minTime?: number;
  maxTime?: number;
  runs?: number;
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

interface AveragedDiagnostics extends PackageDiagnostics {
  minTime: number;
  maxTime: number;
  runs: number;
}

async function runDiagnosticsMultiple(
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

function PerformanceTable({
  results,
  limits,
  isCheckMode = false,
  rerunningPackages = new Set(),
}: {
  results: PackageDiagnostics[];
  limits?: PerformanceLimits;
  isCheckMode?: boolean;
  rerunningPackages?: Set<string>;
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
        const isRerunning = rerunningPackages.has(result.name);
        const status = getPackageStatus(
          result,
          limits,
          isCheckMode,
          isRerunning,
        );
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
  const [limitsLoadError, setLimitsLoadError] = useState<string | null>(null);
  const [rerunningPackages, setRerunningPackages] = useState<Set<string>>(
    new Set(),
  );
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
        setLimitsLoadError(null);
      } catch (error) {
        setLimitsLoadError(
          error instanceof Error ? error.message : "Failed to load limits",
        );
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
        // After initial pass, check for failures and rerun if needed
        if (!isCancelled && isCheckMode && limits) {
          const failedPackages: string[] = [];

          for (const pkg of currentResults) {
            const max = limits.packages[pkg.name];
            if (!max || pkg.time > max) {
              failedPackages.push(pkg.name);
            }
          }

          // Rerun failed packages with averaging
          if (failedPackages.length > 0) {
            const rerunNext = async (rerunIndex: number) => {
              if (isCancelled || rerunIndex >= failedPackages.length) {
                // Final check after reruns
                const totalTime = currentResults.reduce(
                  (sum, r) => sum + r.time,
                  0,
                );
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
                    if (
                      pkg.runs && pkg.runs > 1 && pkg.minTime && pkg.maxTime
                    ) {
                      errors.push(
                        `Package "${pkg.name}": avg ${
                          pkg.time.toFixed(2)
                        }ms (range: ${pkg.minTime.toFixed(2)}-${
                          pkg.maxTime.toFixed(2)
                        }ms) exceeds max ${max}ms (+${
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
                  } else if (
                    pkg.time < max * limits.headroomWarningThreshold
                  ) {
                    warnings.push(
                      `Package "${pkg.name}": ${pkg.time.toFixed(2)}ms is ${
                        ((1 - pkg.time / max) * 100).toFixed(1)
                      }% below max ${max}ms. Consider lowering limit to ${
                        Math.ceil(pkg.time * 1.3)
                      }ms`,
                    );
                  }
                }

                setRerunningPackages(new Set());
                setCheckResult({
                  passed: errors.length === 0,
                  errors,
                  warnings,
                });
                return;
              }

              if (isCancelled) return;

              const packageName = failedPackages[rerunIndex];

              // Set rerunning state and allow React to render
              setRerunningPackages(prev => new Set(prev).add(packageName));
              setResults([...currentResults]); // Force re-render

              // Small delay to ensure UI updates
              await new Promise(resolve => setTimeout(resolve, 100));

              if (isCancelled) return;

              const averaged = await runDiagnosticsMultiple(
                packageName,
                3,
                () => {
                  // Update UI during rerun progress if needed
                  if (!isCancelled) {
                    setResults([...currentResults]);
                  }
                },
              );

              if (averaged && !isCancelled) {
                // Update the result with averaged values
                const resultIndex = currentResults.findIndex(
                  r => r.name === packageName,
                );
                if (resultIndex >= 0) {
                  currentResults[resultIndex] = {
                    ...currentResults[resultIndex],
                    time: averaged.time,
                    minTime: averaged.minTime,
                    maxTime: averaged.maxTime,
                    runs: averaged.runs,
                  };
                  setResults([...currentResults]);
                }
              }

              // Remove from rerunning state
              setRerunningPackages(prev => {
                const next = new Set(prev);
                next.delete(packageName);
                return next;
              });

              if (!isCancelled) {
                // Small delay before next package
                await new Promise(resolve => setTimeout(resolve, 50));
                rerunNext(rerunIndex + 1);
              }
            };

            rerunNext(0);
            return;
          }

          // No failures, do final check
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

  // Only show error if we've attempted to load and it failed
  if (isCheckMode && limitsLoadError) {
    return (
      <Box flexDirection="column">
        <Text color="red">
          Error: {limitsLoadError}
        </Text>
        <Text color="red">
          Create .github/tsc-performance-limits.json
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
          rerunningPackages={rerunningPackages}
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
