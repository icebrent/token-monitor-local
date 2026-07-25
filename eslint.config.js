'use strict';

const path = require('node:path');
const js = require('@eslint/js');
const globals = require('globals');
const { includeIgnoreFile } = require('@eslint/compat');

module.exports = [
  includeIgnoreFile(path.resolve(__dirname, '.gitignore')),
  js.configs.recommended,
  {
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node, window: 'readonly', self: 'readonly' }
    }
  },
  {
    files: ['src/electron/renderer/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser }
    }
  },
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true
      }]
    }
  }
];
