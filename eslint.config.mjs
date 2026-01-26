// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['**/dist/**', '**/.next/**', '**/out/**', '**/node_modules/**', '**/.turbo/**'],
  },
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-console': 'off',
    },
  },
  // Package boundary enforcement (ADR-0019)
  {
    files: ['packages/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '@rippledb/*',
            '../*',
            '../**',
            '../../*',
            '../../**',
          ],
        },
      ],
    },
  },
  {
    files: ['packages/client/**/*.{ts,tsx}', 'packages/server/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '@rippledb/store-*',
            '@rippledb/db-*',
            '@rippledb/bind-*',
          ],
        },
      ],
    },
  },
  {
    files: ['packages/store-*/**/*.{ts,tsx}', 'packages/db-*/**/*.{ts,tsx}', 'packages/bind-*/**/*.{ts,tsx}'],
    rules: {
      // These are allowed to depend on core and (optionally) client/server.
      'no-restricted-imports': [
        'error',
        {
          patterns: [],
        },
      ],
    },
  },
);

