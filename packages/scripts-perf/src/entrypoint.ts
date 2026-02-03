#!/usr/bin/env node
/**
 * TypeScript Performance Diagnostics - Entry Point
 *
 * Routes to either Ink (TTY) or Console (CI) mode based on environment
 */

const isCheckMode = process.argv.includes("--check");
const isCalibrate = process.argv.includes("--calibrate");
const isTTY = process.stdout.isTTY && process.stderr.isTTY;

async function main() {
  // Handle calibration mode
  if (isCalibrate) {
    if (isTTY && !process.env.CI) {
      // Use Ink for interactive calibration
      const { runInkMode } = await import("./tty.js");
      runInkMode(false, true)
        .then(() => {
          process.exit(0);
        })
        .catch(() => {
          process.exit(1);
        });
    } else {
      // Console mode for calibration
      const { runCalibrationMode } = await import("./ci.js");
      runCalibrationMode()
        .then(({ exitCode }) => {
          process.exit(exitCode);
        })
        .catch(error => {
          console.error("Error:", error);
          process.exit(1);
        });
    }
    return;
  }

  // Regular check or diagnose mode
  if (isTTY && !process.env.CI) {
    // Use Ink for interactive terminal
    const { runInkMode } = await import("./tty.js");
    runInkMode(isCheckMode, false)
      .then(() => {
        process.exit(0);
      })
      .catch(() => {
        process.exit(1);
      });
  } else {
    // Non-TTY or CI - use console output
    const { runConsoleMode } = await import("./ci.js");
    runConsoleMode(isCheckMode)
      .then(({ exitCode }) => {
        process.exit(exitCode);
      })
      .catch(error => {
        console.error("Error:", error);
        process.exit(1);
      });
  }
}

main();
