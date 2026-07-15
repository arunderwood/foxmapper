import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      // tsconfig sets noUncheckedIndexedAccess, which types every array read as `T | undefined`.
      // Inside a bounds-checked loop the assertion is the honest expression of what the code
      // already knows, and the alternative is a runtime branch that can never be taken.
      '@typescript-eslint/no-non-null-assertion': 'off',

      // A leading underscore marks a binding that exists to be discarded — destructuring a field
      // out of an object is the clearest way to drop it, and the name documents the intent.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
);
