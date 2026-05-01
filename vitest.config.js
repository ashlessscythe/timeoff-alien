'use strict'

const path = require('path')

/** @type {import('vitest').UserConfig} */
module.exports = {
  test: {
    environment: 'node',
    globals: false,
    globalSetup: path.join(__dirname, 'tests/globalSetup.js'),
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    maxConcurrency: 1,
    testTimeout: 60000,
    hookTimeout: 60000,
    include: ['tests/**/*.test.mjs'],
    exclude: ['node_modules/**']
  }
}
