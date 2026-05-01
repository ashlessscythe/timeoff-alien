'use strict'

/** @type {import('vitest').UserConfig} */
module.exports = {
  test: {
    environment: 'node',
    globals: false,
    fileParallelism: true,
    testTimeout: 10000,
    hookTimeout: 10000,
    include: ['tests/unit/**/*.test.mjs'],
    exclude: ['node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['lib/**/*.js', 'app.js'],
      exclude: ['lib/prisma/client.js', 'tests/**', 'node_modules/**']
    }
  }
}
