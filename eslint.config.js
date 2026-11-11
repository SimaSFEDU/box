const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', 'android/*', 'ios/*', 'modules/*/build/*', '**/*.generated.ts'] },
  {
    // Layering rules — see docs/ARCHITECTURE.md §2.
    files: ['src/app/**', 'src/ui/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['**/data/db/*', 'expo-sqlite'], message: 'UI must not access the database directly; use stores/services.' }] }],
    },
  },
  {
    files: ['src/core/**', 'src/data/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['react', 'react-native'], message: 'core/data layers are UI-free.' }] }],
    },
  },
  {
    files: ['src/**'],
    ignores: ['src/secure/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: 'clipbox-native', importNames: ['ClipboxVault'], message: 'Only src/secure may use protected native APIs.' }] }],
    },
  },
]);
