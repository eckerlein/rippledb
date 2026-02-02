import { AdrBento } from "@/components/adr/adr-bento";
import { ArchitectureStack } from "@/components/architecture-stack";
import { ArchitectureBento } from "@/components/architecture/architecture-bento";
import { Diagram } from "@/components/diagram";
import { InstallCommandTabs } from "@/components/install-command-tabs";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

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
