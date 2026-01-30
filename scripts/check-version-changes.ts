import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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

function getGitHubEvent(): GitHubEvent {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error('GITHUB_EVENT_PATH environment variable is not set');
  }
  return JSON.parse(readFileSync(eventPath, 'utf-8'));
}

function getHeadRef(): string {
  return process.env.GITHUB_HEAD_REF || '';
}

function isChangesetReleaseBranch(branch: string): boolean {
  return branch.startsWith('changeset-release/');
}

function getModifiedPackageJsonFiles(baseSha: string, headSha: string): {
  added: string[];
  modified: string[];
} {
  try {
    // Get added files (new packages)
    const addedOutput = execSync(
      `git diff "${baseSha}".."${headSha}" --name-only --diff-filter=A`,
      { encoding: 'utf-8' }
    );
    
    // Get modified files (existing packages)
    const modifiedOutput = execSync(
      `git diff "${baseSha}".."${headSha}" --name-only --diff-filter=M`,
      { encoding: 'utf-8' }
    );
    
    const filterPackageJson = (file: string) => /^packages\/.*\/package\.json$/.test(file);
    
    const added = addedOutput
      .split('\n')
      .filter((line) => line.trim())
      .filter(filterPackageJson);
    
    const modified = modifiedOutput
      .split('\n')
      .filter((line) => line.trim())
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
      { encoding: 'utf-8' }
    );

    const dirs = new Set<string>();
    for (const line of output.split('\n')) {
      const match = line.match(/^packages\/([^/]+)\//);
      if (match) dirs.add(match[1]);
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
      { encoding: 'utf-8' }
    );

    return output
      .split('\n')
      .some((line) => line.trim().endsWith('.md'));
  } catch {
    return false;
  }
}

function hasVersionFieldChanged(baseSha: string, headSha: string, file: string): boolean {
  try {
    const diff = execSync(
      `git diff "${baseSha}".."${headSha}" -- "${file}"`,
      { encoding: 'utf-8' }
    );
    
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
    execSync(`git fetch origin "${baseRef}:${baseRef}"`, { stdio: 'ignore' });
  } catch {
    // Ignore errors - the branch might already be fetched
    console.warn(`Warning: Could not fetch base branch ${baseRef}`);
  }
}

function getPackageVersion(file: string): string | null {
  try {
    const content = readFileSync(file, 'utf-8');
    const packageJson = JSON.parse(content);
    return packageJson.version || null;
  } catch {
    return null;
  }
}

function isValidInitialVersion(version: string): boolean {
  // New packages should start with 0.1.0
  return version === '0.1.0';
}

function main(): void {
  const headRef = getHeadRef();
  let hasErrors = false;
  
  // Check if this is a changeset-release branch
  if (isChangesetReleaseBranch(headRef)) {
    console.log(`PR is from ${headRef} (changeset-release branch), allowing version changes`);
    process.exit(0);
  }

  console.log(`PR is from ${headRef}, checking for version changes`);

  const event = getGitHubEvent();
  const pr = event.pull_request;
  
  if (!pr) {
    console.error('No pull request information found in GitHub event');
    process.exit(1);
    return; // TypeScript type narrowing
  }

  const baseRef = pr.base.ref;
  const baseSha = pr.base.sha;
  const headSha = pr.head.sha;

  // Fetch the base branch to ensure we can diff against it
  fetchBaseBranch(baseRef);

  // Get all modified package.json files in packages/
  const { added, modified } = getModifiedPackageJsonFiles(baseSha, headSha);

  // Validate version fields in new packages (added files)
  // New packages must start with version 0.1.0
  const invalidNewPackages: string[] = [];
  
  for (const file of added) {
    const version = getPackageVersion(file);
    if (!version) {
      console.error(`❌ New package ${file} is missing a version field`);
      invalidNewPackages.push(file);
    } else if (!isValidInitialVersion(version)) {
      console.error(`❌ New package ${file} has version "${version}", but new packages must start with "0.1.0"`);
      invalidNewPackages.push(file);
    } else {
      console.log(`✓ New package ${file} has valid initial version: ${version}`);
    }
  }

  if (invalidNewPackages.length > 0) {
    console.error('');
    console.error('::error::New packages must start with version "0.1.0"');
    console.error('::error::Please set the version field to "0.1.0" for new packages.');
    hasErrors = true;
  }

  if (added.length > 0) {
    console.log(`✓ All new packages have valid initial versions: ${added.join(', ')}`);
  }

  const changedPackageDirs = getChangedPackageDirs(baseSha, headSha);
  if (changedPackageDirs.length > 0 && !hasChangesetFile(baseSha, headSha)) {
    console.error('');
    console.error('::error::Package changes detected without a changeset');
    console.error('::error::Please add a changeset file in .changeset/');
    console.error(`::error::Changed packages: ${changedPackageDirs.join(', ')}`);
    hasErrors = true;
  }

  if (modified.length === 0) {
    console.log('No existing package.json files in packages/ were modified');
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
      console.error('');
      console.error('::error::Version changes detected in package.json files within packages/ directory');
      console.error('::error::Version changes should only come from changeset-release/* branches');
      console.error('::error::Please remove version changes from this PR. Versions are managed automatically by changesets.');
      hasErrors = true;
    }
  }
  if (hasErrors) {
    process.exit(1);
  }

  console.log('✓ No version field changes detected in packages/');
  process.exit(0);
}

main();
