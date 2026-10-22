'use strict';
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/', 'public/', 'data/', 'coverage/', 'aliran-cashflow.html'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error'
    }
  },
  {
    files: ['tests/**/*.js'],
    rules: { 'no-eval': 'off' } // tests drive the page's script through window.eval
  }
];
