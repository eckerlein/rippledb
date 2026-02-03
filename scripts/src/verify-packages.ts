import type { Dirent } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../..");
const packagesDir = join(repoRoot, "packages");

interface PackageJson {
  name?: string;
  scripts?: {
    build?: string;
    [key: string]: string | undefined;
  };
  tsup?: {
    dts?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface TsconfigBuildJson {
  extends?: string;
  compilerOptions?: {
    emitDeclarationOnly?: boolean;
    declarationMap?: boolean;
    outDir?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(p: string): Promise<T> {
  const raw = await readFile(p, "utf8");
  return JSON.parse(raw) as T;
}

function fail(pkgName: string, msg: string): string {
  return `- ${pkgName}: ${msg}`;
}

async function main() {
  const dirs = (await readdir(packagesDir, { withFileTypes: true }))
    .filter((d: Dirent) => d.isDirectory())
    .map((d: Dirent) => d.name)
    .sort();

  const errors: string[] = [];

  for (const dir of dirs) {
    const pkgPath = join(packagesDir, dir);
    const pkgJsonPath = join(pkgPath, "package.json");
    const tsconfigPath = join(pkgPath, "tsconfig.json");
    const tsconfigBuildPath = join(pkgPath, "tsconfig.build.json");

    const hasPkgJson = await exists(pkgJsonPath);
    if (!hasPkgJson) {
      errors.push(fail(dir, "missing package.json"));
      continue;
    }

    const pkgJson = await readJson<PackageJson>(pkgJsonPath);
    const name = pkgJson.name ?? dir;

    if (!(await exists(tsconfigPath))) {
      errors.push(fail(name, "missing tsconfig.json"));
    }
    if (!(await exists(tsconfigBuildPath))) {
      errors.push(fail(name, "missing tsconfig.build.json"));
    }

    const build = pkgJson.scripts?.build;
    if (
      typeof build !== "string"
      || !build.includes("tsc -p tsconfig.build.json")
    ) {
      errors.push(
        fail(name, "scripts.build should include `tsc -p tsconfig.build.json`"),
      );
    }

    if (pkgJson.tsup?.dts !== false) {
      errors.push(
        fail(
          name,
          "package.json tsup.dts should be false (tsc emits .d.ts + .d.ts.map)",
        ),
      );
    }

    // Optional: validate tsconfig.build.json content when present.
    if (await exists(tsconfigBuildPath)) {
      const tscb = await readJson<TsconfigBuildJson>(tsconfigBuildPath);
      const ext = tscb.extends;
      if (ext !== "./tsconfig.json") {
        errors.push(
          fail(name, "tsconfig.build.json should extend ./tsconfig.json"),
        );
      }
      const co = tscb.compilerOptions;
      if (co?.emitDeclarationOnly !== true) {
        errors.push(
          fail(
            name,
            "tsconfig.build.json should set emitDeclarationOnly: true",
          ),
        );
      }
      if (co?.declarationMap !== true) {
        errors.push(
          fail(name, "tsconfig.build.json should set declarationMap: true"),
        );
      }
      if (co?.outDir !== "./dist") {
        errors.push(
          fail(name, "tsconfig.build.json should set outDir: ./dist"),
        );
      }
    }
  }

  if (errors.length > 0) {
    stderr.write(
      `verify-packages: found ${errors.length} issue(s)\n\n`,
    );
    for (const e of errors) stderr.write(`${e}\n`);
    exit(1);
  }

  stdout.write(`verify-packages: OK (${dirs.length} packages)\n`);
}

main();
