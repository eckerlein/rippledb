import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { Tabs, Tab } from 'fumadocs-ui/components/tabs';
import { AdrBento } from '@/components/adr/adr-bento';
import { ArchitectureBento } from '@/components/architecture/architecture-bento';
import { ArchitectureStack } from '@/components/architecture-stack';
import { Diagram } from '@/components/diagram';
import { InstallCommandTabs } from '@/components/install-command-tabs';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Tabs,
    Tab,
    AdrBento,
    ArchitectureBento,
    ArchitectureStack,
    Diagram,
    InstallCommandTabs,
    ...components,
  };
}
