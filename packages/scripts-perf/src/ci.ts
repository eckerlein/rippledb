/**
 * Console Mode for CI - No TTY, simple console.log output
 */

import {
  applyCalibrationFactor,
  calibratePerformance,
  checkPerformance,
  type CheckResult,
  getPackages,
  loadLimits,
  loadLocalCalibration,
  type LocalCalibration,
  type PackageDiagnostics,
  type PerformanceLimits,
  runDiagnostics,
  runDiagnosticsMultiple,
} from "./logic.js";

export async function runCalibrationMode(): Promise<{ exitCode: number; }> {
  console.log("🔧 TypeScript Performance Calibration");
  console.log("=".repeat(80));
  console.log("\nThis will run all packages 3x to establish a local baseline.");
  console.log("Results will be saved to .tsc-performance-local.json\n");

  try {
    const calibration = await calibratePerformance(
      (message, packageName, current, total) => {
        if (packageName && current && total) {
          console.log(`  [${current}/${total}] ${message}`);
        } else {
          console.log(`\n${message}`);
        }
      },
    );

    console.log("\n" + "=".repeat(80));
    console.log("✅ Calibration complete!\n");
    console.log(
      `  Calibration factor: ${calibration.calibrationFactor.toFixed(3)}x`,
    );
    console.log(
      `  Local baseline: ${calibration.baselineTotalTime.toFixed(0)}ms`,
    );
    console.log(`  CI baseline: ${calibration.ciTotalMax}ms`);
    console.log(`  Saved to: .tsc-performance-local.json`);
    console.log(
      "\nYou can now run 'pnpm perf:check' to validate local performance.\n",
    );

    return { exitCode: 0 };
  } catch (error) {
    console.error("\n❌ Calibration failed:");
    console.error(error instanceof Error ? error.message : String(error));
    return { exitCode: 1 };
  }
}

export async function runConsoleMode(
  isCheckMode: boolean,
): Promise<{ exitCode: number; }> {
  const packages = getPackages();
  let results: PackageDiagnostics[] = [];
  let limits: PerformanceLimits | null = null;
  let localCalibration: LocalCalibration | null = null;

  if (isCheckMode) {
    try {
      limits = loadLimits();

      // In CI, never use local calibration
      if (!process.env.CI) {
        localCalibration = loadLocalCalibration();
        if (localCalibration) {
          limits = applyCalibrationFactor(
            limits,
            localCalibration.calibrationFactor,
          );
        }
      }
    } catch (error) {
      console.error(
        `Error: ${
          error instanceof Error ? error.message : "Failed to load limits"
        }`,
      );
      console.error("Create .github/tsc-performance-limits.json");
      return { exitCode: 1 };
    }
  }

  console.log(
    isCheckMode
      ? "🔍 TypeScript Performance Check"
      : "🔍 TypeScript Extended Diagnostics for All Packages",
  );
  console.log("=".repeat(80));

  if (isCheckMode && localCalibration && !process.env.CI) {
    console.log(
      `\nℹ️  Using local calibration (factor: ${
        localCalibration.calibrationFactor.toFixed(3)
      }x, calibrated: ${
        new Date(localCalibration.calibratedAt).toLocaleString()
      })\n`,
    );
  } else if (isCheckMode && !localCalibration && !process.env.CI) {
    console.log(
      "\n⚠️  No local calibration found. Run 'pnpm perf:calibrate' for accurate local checks.\n",
    );
  }

  // Initial pass
  console.log("\n📦 Running diagnostics for all packages...\n");
  for (const pkg of packages) {
    console.log(`  Checking ${pkg}...`);
    const result = runDiagnostics(pkg);
    if (result) {
      results.push(result);
      const status = result.errors > 0 ? "❌" : "✅";
      console.log(`  ${status} ${pkg}: ${result.time.toFixed(2)}ms`);
    }
  }

  // Rerun failed packages in check mode
  if (isCheckMode && limits) {
    const failedPackages = results.filter(pkg => {
      const max = limits!.packages[pkg.name];
      return !max || pkg.time > max;
    });

    if (failedPackages.length > 0) {
      console.log(
        `\n🔄 Rerunning ${failedPackages.length} failed package(s) with averaging (3x)...\n`,
      );

      for (const pkg of failedPackages) {
        console.log(`  🔄 Rerunning ${pkg.name}...`);
        const averaged = await runDiagnosticsMultiple(pkg.name, 3);
        if (averaged) {
          const resultIndex = results.findIndex(r => r.name === pkg.name);
          if (resultIndex >= 0) {
            results[resultIndex] = {
              ...results[resultIndex],
              time: averaged.time,
              minTime: averaged.minTime,
              maxTime: averaged.maxTime,
              runs: averaged.runs,
            };
          }
          console.log(
            `  ✅ ${pkg.name}: avg ${averaged.time.toFixed(2)}ms (range: ${
              averaged.minTime.toFixed(2)
            }-${averaged.maxTime.toFixed(2)}ms)`,
          );
        }
      }
    }
  }

  // Print summary table
  console.log("\n" + "=".repeat(80));
  console.log("📊 Summary\n");

  const sorted = [...results].sort((a, b) => b.time - a.time);
  const hasLimits = limits !== undefined;

  // Header
  if (hasLimits) {
    console.log(
      "  Package".padEnd(32)
        + "Time (ms)".padEnd(12)
        + "Max (ms)".padEnd(12)
        + "Files".padEnd(8)
        + "Lines".padEnd(10)
        + "Errors",
    );
  } else {
    console.log(
      "Package".padEnd(30)
        + "Time (ms)".padEnd(12)
        + "Files".padEnd(8)
        + "Lines".padEnd(10)
        + "Errors",
    );
  }
  console.log("-".repeat(hasLimits ? 94 : 82));

  // Rows
  for (const result of sorted) {
    const max = limits?.packages[result.name];
    const maxStr = max ? max.toString() : "-";
    const status = result.errors > 0
      ? "❌"
      : limits && !max
      ? isCheckMode ? "❌" : "✅"
      : limits && result.time > max!
      ? "❌"
      : limits && result.time < max! * limits.headroomWarningThreshold
      ? "⚠️"
      : "✅";

    if (hasLimits) {
      console.log(
        `${status} ${result.name}`.padEnd(32)
          + result.time.toFixed(2).padEnd(12)
          + maxStr.padEnd(12)
          + result.files.toString().padEnd(8)
          + result.lines.toLocaleString().padEnd(10)
          + (result.errors > 0 ? `⚠️  ${result.errors}` : "✓"),
      );
    } else {
      console.log(
        `${status} ${result.name}`.padEnd(30)
          + result.time.toFixed(2).padEnd(12)
          + result.files.toString().padEnd(8)
          + result.lines.toLocaleString().padEnd(10)
          + (result.errors > 0 ? `⚠️  ${result.errors}` : "✓"),
      );
    }
  }

  // Total
  const totalTime = results.reduce((sum, r) => sum + r.time, 0);
  const totalFiles = results.reduce((sum, r) => sum + r.files, 0);
  const totalLines = results.reduce((sum, r) => sum + r.lines, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);

  console.log("-".repeat(hasLimits ? 94 : 82));
  if (hasLimits) {
    console.log(
      "  TOTAL".padEnd(32)
        + totalTime.toFixed(2).padEnd(12)
        + (limits?.totalMax ? limits.totalMax.toString() : "-").padEnd(12)
        + totalFiles.toString().padEnd(8)
        + totalLines.toLocaleString().padEnd(10)
        + (totalErrors > 0 ? `⚠️  ${totalErrors}` : "✓"),
    );
  } else {
    console.log(
      "TOTAL".padEnd(30)
        + totalTime.toFixed(2).padEnd(12)
        + totalFiles.toString().padEnd(8)
        + totalLines.toLocaleString().padEnd(10)
        + (totalErrors > 0 ? `⚠️  ${totalErrors}` : "✓"),
    );
  }

  // Check results in check mode
  if (isCheckMode && limits) {
    const checkResult = checkPerformance(results, limits);

    console.log("\n" + "=".repeat(80));
    console.log("=".repeat(80) + "\n");

    if (checkResult.errors.length > 0) {
      console.log("❌ Performance Check Failed:");
      for (const error of checkResult.errors) {
        console.log(`  • ${error}`);
      }
    }

    if (checkResult.warnings.length > 0) {
      console.log("\n⚠️  Warnings:");
      for (const warning of checkResult.warnings) {
        console.log(`  • ${warning}`);
      }
    }

    if (checkResult.passed) {
      console.log("\n✅ All performance checks passed!");
    } else {
      console.log("\n💡 Consider:");
      console.log("  - Review recent type changes");
      console.log("  - Check for new dependencies");
      console.log("  - Run 'pnpm perf:find-types' to identify slow types");
      console.log(
        "  - Update limits in .github/tsc-performance-limits.json if appropriate",
      );
    }

    return { exitCode: checkResult.passed ? 0 : 1 };
  }

  return { exitCode: 0 };
}
