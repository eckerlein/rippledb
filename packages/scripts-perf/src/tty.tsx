/**
 * TTY Mode - Ink/React UI for interactive terminals
 */

import { Box, render, Text } from "ink";
import React, { useEffect, useState } from "react";
import {
  applyCalibrationFactor,
  calibratePerformance,
  checkPerformance,
  type CheckResult,
  getPackages,
  getPackageStatus,
  loadLimits,
  loadLocalCalibration,
  type LocalCalibration,
  type PackageDiagnostics,
  type PerformanceLimits,
  runDiagnostics,
  runDiagnosticsMultiple,
} from "./logic.js";

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

export function CalibrationApp() {
  const [status, setStatus] = useState<string>("Initializing...");
  const [progress, setProgress] = useState<string>("");
  const [completed, setCompleted] = useState(false);
  const [calibration, setCalibration] = useState<LocalCalibration | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const runCalibration = async () => {
      try {
        setStatus("Running calibration...");
        const result = await calibratePerformance(
          (message, packageName, current, total) => {
            if (isCancelled) return;

            if (packageName && current && total) {
              setProgress(`[${current}/${total}] ${packageName}`);
            } else {
              setStatus(message);
            }
          },
        );

        if (!isCancelled) {
          setCalibration(result);
          setCompleted(true);
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    runCalibration();

    return () => {
      isCancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">❌ Calibration failed:</Text>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  if (completed && calibration) {
    return (
      <Box flexDirection="column">
        <Text>🔧 TypeScript Performance Calibration</Text>
        <Text>{"=".repeat(80)}</Text>
        <Text></Text>
        <Text color="green">✅ Calibration complete!</Text>
        <Text></Text>
        <Text>
          Calibration factor: {calibration.calibrationFactor.toFixed(3)}x
        </Text>
        <Text>
          Local baseline: {calibration.baselineTotalTime.toFixed(0)}ms
        </Text>
        <Text>CI baseline: {calibration.ciTotalMax}ms</Text>
        <Text>Saved to: .tsc-performance-local.json</Text>
        <Text></Text>
        <Text>
          You can now run 'pnpm perf:check' to validate local performance.
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text>🔧 TypeScript Performance Calibration</Text>
      <Text>{"=".repeat(80)}</Text>
      <Text></Text>
      <Text>{status}</Text>
      {progress && <Text>{progress}</Text>}
    </Box>
  );
}

export function App({ isCheckMode }: { isCheckMode: boolean; }) {
  const [results, setResults] = useState<PackageDiagnostics[]>([]);
  const [limits, setLimits] = useState<PerformanceLimits | null>(null);
  const [localCalibration, setLocalCalibration] = useState<
    LocalCalibration | null
  >(null);
  const [limitsLoadError, setLimitsLoadError] = useState<string | null>(null);
  const [rerunningPackages, setRerunningPackages] = useState<Set<string>>(
    new Set(),
  );
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);

  // Load limits once on mount (not in effect to avoid loop)
  useEffect(() => {
    if (isCheckMode) {
      try {
        let ciLimits = loadLimits();
        const calibration = loadLocalCalibration();

        if (calibration) {
          setLocalCalibration(calibration);
          ciLimits = applyCalibrationFactor(
            ciLimits,
            calibration.calibrationFactor,
          );
        }

        setLimits(ciLimits);
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
                const checkRes = checkPerformance(currentResults, limits);
                setRerunningPackages(new Set());
                setCheckResult(checkRes);
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
          const checkRes = checkPerformance(currentResults, limits);
          setCheckResult(checkRes);
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
      {isCheckMode && localCalibration && (
        <>
          <Text></Text>
          <Text>
            ℹ️ Using local calibration (factor:{" "}
            {localCalibration.calibrationFactor.toFixed(3)}x, calibrated:{" "}
            {new Date(localCalibration.calibratedAt).toLocaleString()})
          </Text>
        </>
      )}
      {isCheckMode && !localCalibration && (
        <>
          <Text></Text>
          <Text color="yellow">
            ⚠️ No local calibration found. Run 'pnpm perf:calibrate' for accurate
            local checks.
          </Text>
        </>
      )}
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

export function runInkMode(
  isCheckMode: boolean,
  isCalibrate: boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const instance = render(
      isCalibrate
        ? React.createElement(CalibrationApp)
        : React.createElement(App, { isCheckMode }),
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
      resolve();
    };

    process.on("SIGINT", handleExit);
    process.on("SIGTERM", handleExit);

    instance.waitUntilExit().then(() => {
      if (!isExiting) {
        resolve();
      }
    }).catch(() => {
      if (!isExiting) {
        reject(new Error("Ink app failed"));
      }
    });
  });
}
