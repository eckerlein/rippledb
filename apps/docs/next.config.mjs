import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const isExport = process.env.DOCS_EXPORT === '1';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const config = {
  reactStrictMode: true,
  ...(isExport
    ? {
        output: 'export',
        trailingSlash: true,
        // GitHub Pages has no image optimizer runtime.
        images: { unoptimized: true },
        // Project Pages need basePath (e.g. /repo). User/Org pages should leave it empty.
        basePath,
        assetPrefix: basePath,
      }
    : {
        async rewrites() {
          return [
            {
              source: '/docs/:path*.mdx',
              destination: '/llms.mdx/docs/:path*',
            },
          ];
        },
      }),
};

export default withMDX(config);
