'use client';

import { Tabs, Tab } from 'fumadocs-ui/components/tabs';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';
import { getInstallCommand, type PackageManager } from '@/lib/package-manager';

export interface InstallCommandTabsProps {
  packages?: string | string[];
  devPackages?: string | string[];
  packageManagers?: PackageManager[];
}

export function InstallCommandTabs({
  packages,
  devPackages,
  packageManagers = ['pnpm', 'npm', 'yarn'],
}: InstallCommandTabsProps) {
  const commands = packages ? getInstallCommand(packages, { dev: false }) : null;
  const devCommands = devPackages ? getInstallCommand(devPackages, { dev: true }) : null;

  if (!commands && !devCommands) {
    throw new Error('InstallCommandTabs requires at least one of packages or devPackages');
  }

  return (
    <Tabs items={packageManagers} groupId="package-manager">
      {packageManagers.map((pm) => {
        const combinedCommand = commands && devCommands
          ? `${commands[pm]}\n${devCommands[pm]}`
          : commands
          ? commands[pm]
          : devCommands![pm];

        return (
          <Tab key={pm} value={pm}>
            <DynamicCodeBlock lang="bash" code={combinedCommand} />
          </Tab>
        );
      })}
    </Tabs>
  );
}
