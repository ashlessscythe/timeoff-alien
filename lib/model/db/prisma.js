'use strict'

const { PrismaClient } = require('@prisma/client')

let prismaInstance = null

function getInstance() {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      log: process.env.DB_LOGGING === 'true' ? ['query', 'error', 'warn'] : ['error']
    })

    // Handle connection errors
    prismaInstance.$on('error', e => {
      console.error('Prisma Client error:', e)
    })

    // Graceful shutdown
    process.on('SIGINT', async () => {
      await prismaInstance.$disconnect()
      process.exit(0)
    })

    process.on('SIGTERM', async () => {
      await prismaInstance.$disconnect()
      process.exit(0)
    })
  }
  return prismaInstance
}

module.exports = {
  getInstance,
  prisma: getInstance() // For backward compatibility
}
