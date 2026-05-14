'use strict'

const { PrismaClient } = require('@prisma/client')

function prismaLogLevels() {
  if (process.env.NODE_ENV === 'production') {
    return ['error']
  }
  const verbose =
    process.env.PRISMA_LOG_QUERIES === '1' ||
    process.env.PRISMA_LOG_QUERIES === 'true'
  if (verbose) {
    return ['query', 'info', 'warn', 'error']
  }
  return ['warn', 'error']
}

// Create a singleton Prisma client instance
let prisma

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient({
    log: prismaLogLevels(),
    errorFormat: 'minimal'
  })
} else {
  // In development, use a global variable to prevent multiple instances
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      log: prismaLogLevels(),
      errorFormat: 'pretty'
    })
  }
  prisma = global.__prisma
}

// Graceful shutdown
// NOTE: avoid `beforeExit` here; in long-running web servers it can fire in
// unexpected situations and cause disconnect/reconnect churn.
let _disconnecting = false
async function disconnectPrisma() {
  if (_disconnecting) return
  _disconnecting = true
  try {
    await prisma.$disconnect()
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to disconnect Prisma client:', e)
  }
}

process.once('SIGINT', () => disconnectPrisma().finally(() => process.exit(0)))
process.once('SIGTERM', () => disconnectPrisma().finally(() => process.exit(0)))

module.exports = prisma
