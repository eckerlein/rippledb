import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const packagesDir = path.join(repoRoot, "packages");

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson(p: string): Promise<any> {
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw);
}

function fail(pkgName: string, msg: string): string {
  return `- ${pkgName}: ${msg}`;
}

async function main() {
  const dirs = (await fs.readdir(packagesDir, { withFileTypes: true }))
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  const errors: string[] = [];

  for (const dir of dirs) {
    const pkgPath = path.join(packagesDir, dir);
    const pkgJsonPath = path.join(pkgPath, "package.json");
    const tsconfigPath = path.join(pkgPath, "tsconfig.json");
    const tsconfigBuildPath = path.join(pkgPath, "tsconfig.build.json");

    const hasPkgJson = await exists(pkgJsonPath);
    if (!hasPkgJson) {
      errors.push(fail(dir, "missing package.json"));
      continue;
    }

    const pkgJson = await readJson(pkgJsonPath);
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
      const tscb = await readJson(tsconfigBuildPath);
      const ext = tscb.extends;
      if (ext !== "./tsconfig.json") {
        errors.push(
          fail(name, "tsconfig.build.json should extend ./tsconfig.json"),
        );
      }
      const co = tscb.compilerOptions ?? {};
      if (co.emitDeclarationOnly !== true) {
        errors.push(
          fail(
            name,
            "tsconfig.build.json should set emitDeclarationOnly: true",
          ),
        );
      }
      if (co.declarationMap !== true) {
        errors.push(
          fail(name, "tsconfig.build.json should set declarationMap: true"),
        );
      }
      if (co.outDir !== "./dist") {
        errors.push(
          fail(name, "tsconfig.build.json should set outDir: ./dist"),
        );
      }
    }
  }

  if (errors.length > 0) {
    process.stderr.write(
      `verify-packages: found ${errors.length} issue(s)\n\n`,
    );
    for (const e of errors) process.stderr.write(`${e}\n`);
    process.exit(1);
  }

  process.stdout.write(`verify-packages: OK (${dirs.length} packages)\n`);
}

main();
