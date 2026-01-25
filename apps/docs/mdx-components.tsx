import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { AdrBento } from '@/components/adr/adr-bento';
import { ArchitectureBento } from '@/components/architecture/architecture-bento';
import { Diagram } from '@/components/diagram';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    AdrBento,
    ArchitectureBento,
    Diagram,
    ...components,
  };
}
