'use strict'

const { PrismaClient } = require('@prisma/client')

// Initialize Prisma Client with connection retry
async function initPrismaWithRetry(retries = 5, delay = 5000) {
  const prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error']
  })

  for (let i = 0; i < retries; i++) {
    try {
      // Test the connection
      await prisma.$connect()
      console.log('Successfully connected to database')

      // Handle connection errors
      prisma.$on('error', e => {
        console.error('Prisma Client error:', e)
      })

      return prisma
    } catch (error) {
      console.error(`Failed to connect to database (attempt ${i + 1}/${retries}):`, error)

      if (i === retries - 1) {
        console.error('Max retries reached, could not connect to database')
        throw error
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}

// Create a module that exports an async function to get the initialized client
let prismaClient = null

async function getPrismaClient() {
  if (!prismaClient) {
    prismaClient = await initPrismaWithRetry()

    // Graceful shutdown
    process.on('SIGINT', async () => {
      await prismaClient.$disconnect()
      process.exit(0)
    })

    process.on('SIGTERM', async () => {
      await prismaClient.$disconnect()
      process.exit(0)
    })
  }
  return prismaClient
}

// Initialize a singleton instance
const prismaPromise = getPrismaClient().catch(error => {
  console.error('Failed to initialize database connection:', error)
  process.exit(1)
})

// Export both the promise and a function to get the client
module.exports = {
  promise: prismaPromise,
  getInstance: () => prismaPromise
}
