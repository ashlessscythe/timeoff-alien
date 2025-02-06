'use strict'

const { PrismaClient } = require('@prisma/client')

// Initialize Prisma Client with logging if needed
const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error']
})

// Handle connection errors
prisma.$on('error', e => {
  console.error('Prisma Client error:', e)
})

// Graceful shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await prisma.$disconnect()
  process.exit(0)
})

module.exports = prisma
