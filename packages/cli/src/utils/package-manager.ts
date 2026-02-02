import { existsSync } from "node:fs";
import { join } from "node:path";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/**
 * Detect the package manager used in a project by checking for lockfiles.
 */
export function detectPackageManager(
  cwd: string = process.cwd(),
): PackageManager {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "bun.lockb"))) return "bun";
  if (existsSync(join(cwd, "package-lock.json"))) return "npm";
  return "npm";
}

/**
 * Execute the appropriate callback based on detected package manager.
 */
export function withPackageManager<T>(
  handlers: {
    npm: () => T;
    pnpm: () => T;
    yarn: () => T;
    bun: () => T;
  },
  cwd?: string,
): T {
  const pm = detectPackageManager(cwd);
  return handlers[pm]();
}

/**
 * Get the install command for a package.
 */
export function getInstallCommand(
  pkg: string,
  options: { dev?: boolean; cwd?: string } = {},
): string {
  const { dev = false, cwd } = options;

  return withPackageManager(
    {
      npm: () => `npm install ${dev ? "-D " : ""}${pkg}`,
      pnpm: () => `pnpm add ${dev ? "-D " : ""}${pkg}`,
      yarn: () => `yarn add ${dev ? "-D " : ""}${pkg}`,
      bun: () => `bun add ${dev ? "-d " : ""}${pkg}`,
    },
    cwd,
  );
}
