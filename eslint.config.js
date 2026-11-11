const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// Layering rules — see docs/ARCHITECTURE.md §2. Each file group gets ONE no-restricted-imports
// config (later flat-config entries replace earlier ones for the same rule).
const protectedNative = { name: 'clipbox-native', importNames: ['ClipboxVault'], message: 'Only src/secure may use protected native APIs.' };
const noDbInUi = { group: ['**/data/db/*', 'expo-sqlite'], message: 'UI must not access the database directly; use feature hooks/services.' };

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', 'android/*', 'ios/*', 'modules/*/build/*', '**/*.generated.ts'] },
  {
    files: ['src/**'],
    ignores: ['src/secure/**'],
    rules: { 'no-restricted-imports': ['error', { paths: [protectedNative] }] },
  },
  {
    files: ['src/app/**', 'src/ui/**'],
    rules: { 'no-restricted-imports': ['error', { paths: [protectedNative], patterns: [noDbInUi] }] },
  },
  {
    files: ['src/core/**', 'src/data/**', 'src/domain/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: [protectedNative], patterns: [{ group: ['react', 'react-native', 'expo-router'], message: 'core/data/domain layers are UI-free.' }] }],
    },
  },
]);
