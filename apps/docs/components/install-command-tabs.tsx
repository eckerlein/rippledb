'use client';

import { Tabs, Tab } from 'fumadocs-ui/components/tabs';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';
import { getInstallCommand, type PackageManager } from '@/lib/package-manager';

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
  const commands = getInstallCommand(packages, { dev });

  return (
    <Tabs items={packageManagers} groupId="package-manager">
      {packageManagers.map((pm) => (
        <Tab key={pm} value={pm}>
          <DynamicCodeBlock lang="bash" code={commands[pm]} />
        </Tab>
      ))}
    </Tabs>
  );
}
