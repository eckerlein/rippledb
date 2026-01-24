import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

// Compatible with Next.js `output: "export"` (static export)
export const dynamic = 'force-static';
export const revalidate = false;

export const { staticGET: GET } = createFromSource(source, {
  // https://docs.orama.com/docs/orama-js/supported-languages
  language: 'english',
});
