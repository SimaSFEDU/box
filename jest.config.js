/** Two projects: pure TS logic (node, real SQLite) and React Native components (jest-expo). */
module.exports = {
  projects: [
    {
      displayName: 'logic',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/**/*.test.ts'],
      transform: { '^.+\\.tsx?$': ['babel-jest', { presets: ['babel-preset-expo'] }] },
    },
    {
      displayName: 'ui',
      preset: 'jest-expo/android',
      setupFiles: ['<rootDir>/tests/setup-ui.ts'],
      testMatch: ['<rootDir>/tests/**/*.test.tsx'],
    },
  ],
};
