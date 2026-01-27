import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import { Inter } from 'next/font/google';
import SearchDialog from '@/components/search';
import { Metadata } from 'next';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  adjustFontFallback: true,
});

export const metadata: Metadata = {
  title: 'RippleDB',
  description: 'RippleDB is a headless local-first sync engine with field-level conflict resolution. Build offline-first apps with deterministic conflict resolution.',
  icons: {
    icon: [
      {
        media: '(prefers-color-scheme: light)',
        url: '/icon-variations/icon-light.svg',
      },
      {
        media: '(prefers-color-scheme: dark)',
        url: '/icon-variations/icon-dark.svg',
      },
    ],
  },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider
          search={{
            SearchDialog,
          }}
          theme={{
            defaultTheme: 'system',
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
