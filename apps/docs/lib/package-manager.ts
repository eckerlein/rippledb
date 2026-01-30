export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/**
 * Get the install command for packages.
 * Similar to the CLI package's getInstallCommand function.
 */
export function getInstallCommand(
  packages: string | string[],
  options: { dev?: boolean } = {},
): Record<PackageManager, string> {
  const { dev = false } = options;
  const pkgList = Array.isArray(packages) ? packages.join(' ') : packages;
  const devFlag = dev ? '-D ' : '';

  return {
    npm: `npm install ${devFlag}${pkgList}`,
    pnpm: `pnpm add ${devFlag}${pkgList}`,
    yarn: `yarn add ${devFlag}${pkgList}`,
    bun: `bun add ${dev ? '-d ' : ''}${pkgList}`,
  };
}
