'use client';

import { Tabs, Tab } from 'fumadocs-ui/components/tabs';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';
import { getInstallCommand, type PackageManager } from '@/lib/package-manager';

export interface InstallCommandTabsProps {
  packages: string | string[];
  dev?: boolean;
  devPackages?: string | string[];
  packageManagers?: PackageManager[];
}

export function InstallCommandTabs({
  packages,
  dev = false,
  devPackages,
  packageManagers = ['pnpm', 'npm', 'yarn'],
}: InstallCommandTabsProps) {
  const commands = getInstallCommand(packages, { dev });
  const devCommands = devPackages ? getInstallCommand(devPackages, { dev: true }) : null;

  return (
    <Tabs items={packageManagers} groupId="package-manager">
      {packageManagers.map((pm) => {
        const combinedCommand = devCommands
          ? `${commands[pm]}\n${devCommands[pm]}`
          : commands[pm];

        return (
          <Tab key={pm} value={pm}>
            <DynamicCodeBlock lang="bash" code={combinedCommand} />
          </Tab>
        );
      })}
    </Tabs>
  );
}
