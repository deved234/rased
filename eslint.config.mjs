import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['out/**', 'release/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['scripts/**/*.mjs'], languageOptions: { globals: { ...globals.node } } },
  { files: ['scripts/test-chrome-extension.mjs'], languageOptions: { globals: { ...globals.browser,chrome:'readonly' } } }
)
