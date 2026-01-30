'use client';

import { Tabs, Tab } from 'fumadocs-ui/components/tabs';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';
import { getInstallCommand, type PackageManager } from '@/lib/package-manager';

export interface InstallOption {
  value: string;
  label: string;
  packages: string | string[];
  devPackages?: string | string[];
}

export interface NestedInstallCommandTabsProps {
  options: InstallOption[];
  groupId?: string;
  packageManagers?: PackageManager[];
}

export function NestedInstallCommandTabs({
  options,
  groupId = 'install-option',
  packageManagers = ['pnpm', 'npm', 'yarn'],
}: NestedInstallCommandTabsProps) {
  return (
    <Tabs items={options.map((opt) => opt.label)} groupId={groupId}>
      {options.map((option) => {
        const commands = getInstallCommand(option.packages, { dev: false });
        const devCommands = option.devPackages
          ? getInstallCommand(option.devPackages, { dev: true })
          : null;

        return (
          <Tab key={option.value} value={option.label}>
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
          </Tab>
        );
      })}
    </Tabs>
  );
}
