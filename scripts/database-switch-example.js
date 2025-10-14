#!/usr/bin/env node

/**
 * Database Switch Example
 *
 * This script demonstrates how to switch between SQLite and PostgreSQL
 * using both Prisma and Sequelize in the TimeOff Management application.
 */

const { PrismaClient } = require('@prisma/client')
const { Sequelize } = require('sequelize')

// Configuration
const DATABASE_CONFIGS = {
  sqlite: {
    prisma: {
      provider: 'sqlite',
      url: 'file:../app.sqlite'
    },
    sequelize: {
      dialect: 'sqlite',
      storage: './app.sqlite',
      logging: false
    }
  },
  postgresql: {
    prisma: {
      provider: 'postgresql',
      url:
        process.env.DATABASE_URL ||
        'postgresql://user:password@localhost:5432/timeoff_management'
    },
    sequelize: {
      dialect: 'postgres',
      url:
        process.env.DATABASE_URL ||
        'postgresql://user:password@localhost:5432/timeoff_management',
      logging: false,
      pool: {
        max: 5,
        min: 0,
        acquire: 60000,
        idle: 10000
      }
    }
  }
}

class DatabaseSwitcher {
  constructor(databaseType = 'sqlite') {
    this.databaseType = databaseType
    this.config = DATABASE_CONFIGS[databaseType]
    this.prisma = null
    this.sequelize = null
  }

  async initialize() {
    console.log(
      `Initializing ${this.databaseType.toUpperCase()} database connections...`
    )

    try {
      // Initialize Prisma
      this.prisma = new PrismaClient({
        datasources: {
          db: {
            url: this.config.prisma.url
          }
        }
      })

      // Initialize Sequelize
      this.sequelize = new Sequelize(this.config.sequelize)

      // Test connections
      await this.testConnections()

      console.log('✅ Database connections established successfully')
    } catch (error) {
      console.error(
        '❌ Failed to initialize database connections:',
        error.message
      )
      throw error
    }
  }

  async testConnections() {
    // Test Prisma connection
    try {
      await this.prisma.$connect()
      console.log('✅ Prisma connection successful')
    } catch (error) {
      console.error('❌ Prisma connection failed:', error.message)
    }

    // Test Sequelize connection
    try {
      await this.sequelize.authenticate()
      console.log('✅ Sequelize connection successful')
    } catch (error) {
      console.error('❌ Sequelize connection failed:', error.message)
    }
  }

  async demonstrateDataTypes() {
    console.log('\n📊 Demonstrating data type differences...')

    const examples = {
      sqlite: {
        boolean: 'Uses INTEGER (0/1)',
        date: 'Uses TEXT or INTEGER',
        enum: 'Uses TEXT with constraints',
        array: 'Not supported natively',
        json: 'Uses TEXT (with JSON functions)'
      },
      postgresql: {
        boolean: 'Native BOOLEAN type',
        date: 'Native DATE, TIMESTAMP, TIMESTAMPTZ',
        enum: 'Native ENUM type',
        array: 'Native ARRAY type',
        json: 'Native JSON/JSONB types'
      }
    }

    console.log(`\n${this.databaseType.toUpperCase()} Data Types:`)
    Object.entries(examples[this.databaseType]).forEach(
      ([type, description]) => {
        console.log(`  ${type}: ${description}`)
      }
    )
  }

  async demonstrateQueries() {
    console.log('\n🔍 Demonstrating query capabilities...')

    try {
      // Check if tables exist first
      const tables = await this.prisma.$queryRaw`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
      `

      if (tables.length === 0) {
        console.log('📝 No tables found. Run the seed script first:')
        console.log('   node prisma/seed.mjs --clear')
        return
      }

      console.log(
        `📊 Found ${tables.length} tables: ${tables
          .map(t => t.name)
          .join(', ')}`
      )

      // Example: Count companies (if table exists)
      if (tables.some(t => t.name === 'companies')) {
        const companyCount = await this.prisma.companies.count()
        console.log(`📈 Total companies: ${companyCount}`)
      }

      // Example: Count users (if table exists)
      if (tables.some(t => t.name === 'users')) {
        const userCount = await this.prisma.users.count()
        console.log(`👥 Total users: ${userCount}`)
      }

      // Example: Count departments (if table exists)
      if (tables.some(t => t.name === 'departments')) {
        const departmentCount = await this.prisma.departments.count()
        console.log(`🏢 Total departments: ${departmentCount}`)
      }
    } catch (error) {
      console.error('❌ Query demonstration failed:', error.message)
    }
  }

  async demonstrateSequelizeQueries() {
    console.log('\n🔍 Demonstrating Sequelize queries...')

    try {
      // Note: This would require Sequelize models to be defined
      // For demonstration purposes, we'll show the concept
      console.log('📝 Sequelize query examples:')
      console.log('  - Raw SQL queries with database-specific syntax')
      console.log('  - Model associations and joins')
      console.log('  - Transactions and migrations')
      console.log('  - Database-specific features (window functions, etc.)')
    } catch (error) {
      console.error('❌ Sequelize demonstration failed:', error.message)
    }
  }

  async showPerformanceCharacteristics() {
    console.log('\n⚡ Performance characteristics:')

    const characteristics = {
      sqlite: [
        'Single-threaded (one writer at a time)',
        'File-based (no network overhead)',
        'Good for read-heavy workloads',
        'Limited concurrent write performance',
        'No connection pooling needed'
      ],
      postgresql: [
        'Multi-threaded (concurrent operations)',
        'Client-server architecture',
        'Excellent for concurrent workloads',
        'Advanced indexing and query optimization',
        'Connection pooling essential'
      ]
    }

    characteristics[this.databaseType].forEach(char => {
      console.log(`  • ${char}`)
    })
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up connections...')

    if (this.prisma) {
      await this.prisma.$disconnect()
      console.log('✅ Prisma disconnected')
    }

    if (this.sequelize) {
      await this.sequelize.close()
      console.log('✅ Sequelize disconnected')
    }
  }
}

// Main execution
async function main() {
  const databaseType = process.argv[2] || 'sqlite'

  if (!['sqlite', 'postgresql'].includes(databaseType)) {
    console.error('❌ Invalid database type. Use: sqlite or postgresql')
    process.exit(1)
  }

  const switcher = new DatabaseSwitcher(databaseType)

  try {
    await switcher.initialize()
    await switcher.demonstrateDataTypes()
    await switcher.demonstrateQueries()
    await switcher.demonstrateSequelizeQueries()
    await switcher.showPerformanceCharacteristics()
  } catch (error) {
    console.error('❌ Script failed:', error.message)
    process.exit(1)
  } finally {
    await switcher.cleanup()
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error)
}

module.exports = { DatabaseSwitcher, DATABASE_CONFIGS }
