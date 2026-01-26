'use client';

import { useDocsSearch } from 'fumadocs-core/search/client';
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from 'fumadocs-ui/components/dialog/search';
import { useI18n } from 'fumadocs-ui/contexts/i18n';

function joinBasePath(path: string) {
  const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/, '');
  const next = path.startsWith('/') ? path : `/${path}`;
  return `${base}${next}`;
}

export default function StaticSearchDialog(props: SharedProps) {
  const { locale } = useI18n();

  const { search, setSearch, query } = useDocsSearch({
    type: 'static',
    // GitHub Pages project sites live under a basePath (e.g. /rippledb)
    from: joinBasePath('/api/search'),
    locale,
  });

  return (
    <SearchDialog search={search} onSearchChange={setSearch} isLoading={query.isLoading} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={query.data !== 'empty' ? query.data : null} />
      </SearchDialogContent>
    </SearchDialog>
  );
}

