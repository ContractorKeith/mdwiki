import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', Buffer: 'readonly', console: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', URL: 'readonly' },
    },
  },
];
