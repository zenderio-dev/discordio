import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'desktop/node_modules/**', 'desktop/dist/**'] },
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-dupe-args': 'error',
      'no-dupe-keys': 'error',
      'no-import-assign': 'error',
    },
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        AudioWorkletProcessor: 'readonly',
        registerProcessor: 'readonly',
        currentFrame: 'readonly',
        sampleRate: 'readonly',
      },
    },
  },
  { files: ['desktop/**/*.js', '**/*.cjs'], languageOptions: { sourceType: 'commonjs' } },
];
