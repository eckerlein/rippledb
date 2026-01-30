import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { AdrBento } from '@/components/adr/adr-bento';
import { ArchitectureBento } from '@/components/architecture/architecture-bento';
import { ArchitectureStack } from '@/components/architecture-stack';
import { Diagram } from '@/components/diagram';
import { InstallCommandTabs } from '@/components/install-command-tabs';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    AdrBento,
    ArchitectureBento,
    ArchitectureStack,
    Diagram,
    InstallCommandTabs,
    ...components,
  };
}
