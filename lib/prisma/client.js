'use strict'

const { PrismaClient } = require('@prisma/client')

// Create a singleton Prisma client instance
let prisma

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient({
    log: ['error'],
    errorFormat: 'minimal'
  })
} else {
  // In development, use a global variable to prevent multiple instances
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      log: ['query', 'info', 'warn', 'error'],
      errorFormat: 'pretty'
    })
  }
  prisma = global.__prisma
}

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect()
})

module.exports = prisma
