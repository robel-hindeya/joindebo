import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'docs/**', '**/next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/scripts/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { require: 'readonly', __dirname: 'readonly', process: 'readonly', console: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['**/*.config.mjs'],
    languageOptions: { globals: { process: 'readonly' } },
  },
  {
    rules: {
      // PINs, codes and tokens must never reach the logs; keep logging deliberate.
      'no-console': ['warn', { allow: ['log', 'error'] }],
    },
  },
);
