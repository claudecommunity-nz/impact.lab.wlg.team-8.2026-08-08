import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * The rule that makes the swappability claim true rather than aspirational:
 * no hex colour literal may exist outside src/theme/.
 */
const NO_HEX = {
  selector: 'Literal[value=/#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?\\b/]',
  message:
    'No colour literals outside src/theme/. Author the colour in theme/palettes.ts and read it back with cssColor()/rgba().',
};

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    rules: {
      'no-restricted-syntax': ['error', NO_HEX],
    },
  },
  {
    files: ['src/theme/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
