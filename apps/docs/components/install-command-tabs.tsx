'use client';

import { Tabs, Tab } from 'fumadocs-ui/components/tabs';
import { usePackageManager } from './package-manager-context';
import { getInstallCommand, type PackageManager } from '@/lib/package-manager';
import { useMemo } from 'react';

export interface InstallCommandTabsProps {
  packages: string | string[];
  dev?: boolean;
  packageManagers?: PackageManager[];
}

export function InstallCommandTabs({
  packages,
  dev = false,
  packageManagers = ['pnpm', 'npm', 'yarn'],
}: InstallCommandTabsProps) {
  const { packageManager } = usePackageManager();
  const commands = getInstallCommand(packages, { dev });

  // Determine which tab should be active based on global package manager
  const activePackageManager = useMemo(() => {
    return packageManagers.includes(packageManager) ? packageManager : packageManagers[0];
  }, [packageManager, packageManagers]);

  // Reorder packageManagers to put the active one first
  const orderedPackageManagers = useMemo(() => {
    const others = packageManagers.filter((pm) => pm !== activePackageManager);
    return [activePackageManager, ...others];
  }, [activePackageManager, packageManagers]);

  return (
    <Tabs items={orderedPackageManagers}>
      {packageManagers.map((pm) => (
        <Tab key={pm} value={pm}>
          <pre>
            <code className="language-bash">{commands[pm]}</code>
          </pre>
        </Tab>
      ))}
    </Tabs>
  );
}
