import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

interface GitHubEvent {
  pull_request?: {
    base: {
      ref: string;
      sha: string;
    };
    head: {
      ref: string;
      sha: string;
    };
  };
}

function getGitHubEvent(): GitHubEvent | null {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(eventPath, "utf-8"));
  } catch {
    return null;
  }
}

function getHeadRef(): string {
  return process.env.GITHUB_HEAD_REF || "";
}

function getCurrentBranch(): string {
  try {
    return execSync("git branch --show-current", { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function getMergeBase(branch: string = "origin/main"): string {
  try {
    return execSync(`git merge-base HEAD ${branch}`, { encoding: "utf-8" })
      .trim();
  } catch {
    return "";
  }
}

function isChangesetReleaseBranch(branch: string): boolean {
  return branch.startsWith("changeset-release/");
}

function getModifiedPackageJsonFiles(
  baseSha: string,
  headSha: string,
): {
  added: string[];
  modified: string[];
} {
  try {
    // Get added files (new packages)
    const addedOutput = execSync(
      `git diff "${baseSha}".."${headSha}" --name-only --diff-filter=A`,
      { encoding: "utf-8" },
    );

    // Get modified files (existing packages)
    const modifiedOutput = execSync(
      `git diff "${baseSha}".."${headSha}" --name-only --diff-filter=M`,
      { encoding: "utf-8" },
    );

    const filterPackageJson = (file: string) =>
      /^packages\/.*\/package\.json$/.test(file);

    const added = addedOutput
      .split("\n")
      .filter(line => line.trim())
      .filter(filterPackageJson);

    const modified = modifiedOutput
      .split("\n")
      .filter(line => line.trim())
      .filter(filterPackageJson);

    return { added, modified };
  } catch {
    return { added: [], modified: [] };
  }
}

function getChangedPackageDirs(baseSha: string, headSha: string): string[] {
  try {
    const output = execSync(
      `git diff "${baseSha}".."${headSha}" --name-only --diff-filter=AM`,
      { encoding: "utf-8" },
    );

    const dirs = new Set<string>();
    for (const line of output.split("\n")) {
      const match = line.match(/^packages\/([^/]+)\//);
      if (match) {
        const packageDir = match[1];
        const packageJsonPath = `packages/${packageDir}/package.json`;
        // Skip private packages - they don't need changesets
        if (!getPackageIsPrivate(packageJsonPath)) {
          dirs.add(packageDir);
        }
      }
    }

    return Array.from(dirs).sort();
  } catch {
    return [];
  }
}

function hasChangesetFile(baseSha: string, headSha: string): boolean {
  try {
    const output = execSync(
      `git diff "${baseSha}".."${headSha}" --name-only --diff-filter=AM -- .changeset/*.md`,
      { encoding: "utf-8" },
    );

    return output.split("\n").some(line => line.trim().endsWith(".md"));
  } catch {
    return false;
  }
}

function hasVersionFieldChanged(
  baseSha: string,
  headSha: string,
  file: string,
): boolean {
  try {
    const diff = execSync(`git diff "${baseSha}".."${headSha}" -- "${file}"`, {
      encoding: "utf-8",
    });

    // Check if the diff contains BOTH a removal (-) and addition (+) of the "version" field
    // This indicates an actual version change, not just the presence of a version field
    // Match lines starting with "-" (removed) that contain "version"
    const hasRemoval = /^-.*"version"/m.test(diff);
    // Match lines starting with "+" (added) that contain "version"
    const hasAddition = /^\+.*"version"/m.test(diff);

    // A version change means both lines exist (old version removed, new version added)
    return hasRemoval && hasAddition;
  } catch {
    return false;
  }
}

function fetchBaseBranch(baseRef: string): void {
  try {
    execSync(`git fetch origin "${baseRef}:${baseRef}"`, { stdio: "ignore" });
  } catch {
    // Ignore errors - the branch might already be fetched
    console.warn(`Warning: Could not fetch base branch ${baseRef}`);
  }
}

function getPackageVersion(file: string): string | null {
  try {
    const content = readFileSync(file, "utf-8");
    const packageJson = JSON.parse(content);
    return packageJson.version || null;
  } catch {
    return null;
  }
}

function getPackageIsPrivate(file: string): boolean {
  try {
    const content = readFileSync(file, "utf-8");
    const packageJson = JSON.parse(content);
    return packageJson.private || false;
  } catch {
    return false;
  }
}

function isValidInitialVersion(version: string): boolean {
  // New packages should start with 0.1.0
  return version === "0.1.0";
}

function main(): void {
  let hasErrors = false;

  // Detect if running in CI or locally
  const event = getGitHubEvent();
  const isCI = event !== null;

  let baseSha: string;
  let headSha: string;
  let headRef: string;

  if (isCI && event.pull_request) {
    // CI Mode - use GitHub PR data
    const pr = event.pull_request;
    headRef = getHeadRef();
    baseSha = pr.base.sha;
    headSha = pr.head.sha;

    // Check if this is a changeset-release branch
    if (isChangesetReleaseBranch(headRef)) {
      console.log(
        `PR is from ${headRef} (changeset-release branch), allowing version changes`,
      );
      process.exit(0);
    }

    console.log(`PR is from ${headRef}, checking for version changes`);
    fetchBaseBranch(pr.base.ref);
  } else {
    // Local Mode - compare current branch with origin/main
    headRef = getCurrentBranch();
    baseSha = getMergeBase("origin/main");
    headSha = "HEAD";

    if (!baseSha) {
      console.error("⚠️  Could not find merge base with origin/main");
      console.error("This is a local check - skipping validation");
      process.exit(0);
    }

    if (isChangesetReleaseBranch(headRef)) {
      console.log(
        `Current branch ${headRef} (changeset-release branch), allowing version changes`,
      );
      process.exit(0);
    }

    console.log(
      `🔍 Local Mode: Checking branch '${headRef}' for version changes`,
    );
    console.log(
      `   Comparing: ${baseSha.slice(0, 7)}..HEAD (against origin/main)\n`,
    );
  }

  // Get all modified package.json files in packages/
  const { added, modified } = getModifiedPackageJsonFiles(baseSha, headSha);

  // Validate version fields in new packages (added files)
  // New packages must start with version 0.1.0
  const invalidNewPackages: string[] = [];

  for (const file of added) {
    const isPrivate = getPackageIsPrivate(file);
    if (isPrivate) {
      console.log(`✓ New package ${file} is private, skipping version check`);
      continue;
    }

    const version = getPackageVersion(file);
    if (!version) {
      console.error(`❌ New package ${file} is missing a version field`);
      invalidNewPackages.push(file);
    } else if (!isValidInitialVersion(version)) {
      console.error(
        `❌ New package ${file} has version "${version}", but new packages must start with "0.1.0"`,
      );
      invalidNewPackages.push(file);
    } else {
      console.log(
        `✓ New package ${file} has valid initial version: ${version}`,
      );
    }
  }

  if (invalidNewPackages.length > 0) {
    if (isCI) {
      console.error("");
      console.error('::error::New packages must start with version "0.1.0"');
      console.error(
        '::error::Please set the version field to "0.1.0" for new packages.',
      );
      hasErrors = true;
    } else {
      console.log("");
      console.log('⚠️  New packages should start with version "0.1.0"');
      console.log(`   Affected: ${invalidNewPackages.join(", ")}\n`);
    }
  }

  if (added.length > 0) {
    console.log(
      `✓ All new packages have valid initial versions: ${added.join(", ")}`,
    );
  }

  const changedPackageDirs = getChangedPackageDirs(baseSha, headSha);
  if (changedPackageDirs.length > 0 && !hasChangesetFile(baseSha, headSha)) {
    if (isCI) {
      console.error("");
      console.error("::error::Package changes detected without a changeset");
      console.error("::error::Please add a changeset file in .changeset/");
      console.error(
        `::error::Changed packages: ${changedPackageDirs.join(", ")}`,
      );
      hasErrors = true;
    } else {
      console.log("");
      console.log("⚠️  Package changes detected without a changeset:");
      console.log(`   Changed packages: ${changedPackageDirs.join(", ")}`);
      console.log(`   💡 Run 'pnpm changeset' to create one\n`);
    }
  }

  if (modified.length === 0) {
    console.log("No existing package.json files in packages/ were modified");
  } else {
    // Check each modified (existing) package.json for version field changes
    // We only check modified files, not added files (new packages)
    const filesWithVersionChanges: string[] = [];

    for (const file of modified) {
      if (hasVersionFieldChanged(baseSha, headSha, file)) {
        console.error(`❌ Version field changed in ${file}`);
        filesWithVersionChanges.push(file);
      }
    }

    if (filesWithVersionChanges.length > 0) {
      if (isCI) {
        console.error("");
        console.error(
          "::error::Version changes detected in package.json files within packages/ directory",
        );
        console.error(
          "::error::Version changes should only come from changeset-release/* branches",
        );
        console.error(
          "::error::Please remove version changes from this PR. Versions are managed automatically by changesets.",
        );
        hasErrors = true;
      } else {
        console.log("");
        console.log("⚠️  Version field changes detected:");
        console.log(`   Files: ${filesWithVersionChanges.join(", ")}`);
        console.log(
          "   💡 Versions are managed by changesets - consider reverting\n",
        );
      }
    }
  }
  if (hasErrors) {
    process.exit(1);
  }

  if (isCI) {
    console.log("✓ No version field changes detected in packages/");
  } else {
    console.log("✅ Local check complete - no issues found");
  }
  process.exit(0);
}

main();
