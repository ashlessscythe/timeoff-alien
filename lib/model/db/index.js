'use strict'

const fs = require('fs')
const { schema } = require('joi/lib/types/object')
const path = require('path')
const Sequelize = require('sequelize')
const env = process.env.NODE_ENV || 'development'

// Extract the useSSL flag from an environment variable
const useSSL = process.env.USE_SSL === 'true'
console.log('useSSL is:', useSSL)

// Detect database type from DATABASE_URL
const databaseUrl = process.env.DATABASE_URL || ''
const isSQLite =
  databaseUrl.startsWith('file:') || databaseUrl.startsWith('sqlite:')
const isPostgreSQL =
  databaseUrl.startsWith('postgresql:') || databaseUrl.startsWith('postgres:')

console.log(
  'Database type detected:',
  isSQLite ? 'SQLite' : isPostgreSQL ? 'PostgreSQL' : 'Unknown'
)

const databaseConfig = {
  dialectOptions: {},
  logging: (process.env.DB_LOGGING === 'true' && console.log) || false,
  pool: {
    max: parseInt(process.env.DB_POOL_MAX) || 5,
    min: parseInt(process.env.DB_POOL_MIN) || 0,
    acquire: parseInt(process.env.DB_POOL_ACQUIRE) || 60000,
    idle: parseInt(process.env.DB_POOL_IDLE) || 10000
  }
}

// Configure database-specific settings
if (isSQLite) {
  // SQLite-specific configuration
  databaseConfig.dialect = 'sqlite'
  databaseConfig.storage = databaseUrl.replace('file:', '')
  // SQLite doesn't support schema, so remove it
  delete databaseConfig.schema
  // SQLite is single-writer; keep pool small to reduce lock contention
  databaseConfig.pool = {
    max: 1,
    min: 0,
    acquire: parseInt(process.env.DB_POOL_ACQUIRE) || 60000,
    idle: parseInt(process.env.DB_POOL_IDLE) || 10000
  }
} else if (isPostgreSQL) {
  // PostgreSQL-specific configuration
  databaseConfig.dialect = 'postgres'
  databaseConfig.schema = 'public'

  // If SSL is required, configure dialectOptions for SSL
  if (useSSL) {
    databaseConfig.dialectOptions.ssl = {
      require: process.env.DB_SSL_REQUIRE === 'true',
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' // Defaults to true unless explicitly set to 'false'
    }
  }
}

// Initialize Sequelize with the configuration
let sequelize
if (isSQLite) {
  // For SQLite, we need to pass the storage path directly
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: databaseConfig.storage,
    logging: databaseConfig.logging,
    pool: databaseConfig.pool
  })
  // Enable WAL and busy timeout to reduce SQLITE_BUSY
  sequelize
    .query('PRAGMA journal_mode=WAL;')
    .then(() =>
      sequelize.query(
        `PRAGMA busy_timeout = ${parseInt(process.env.SQLITE_BUSY_TIMEOUT_MS) ||
          5000};`
      )
    )
    .catch(err => {
      console.warn(
        'Failed to apply SQLite pragmas:',
        err && err.message ? err.message : err
      )
    })
} else {
  // For other databases, use the DATABASE_URL
  sequelize = new Sequelize(process.env.DATABASE_URL, databaseConfig)
}

console.log('DB Config:', databaseConfig)
console.log('DB URL:', process.env.DATABASE_URL)

// Example of defining models
const db = {}

// Updated model loading for Sequelize v6 (removed sequelize.import)
fs.readdirSync(__dirname)
  .filter(file => file.indexOf('.') !== 0 && file !== 'index.js')
  .forEach(file => {
    const modelDefinition = require(path.join(__dirname, file))
    const model = modelDefinition(sequelize, Sequelize.DataTypes)
    db[model.name] = model
  })

// Link models according associations
//
Object.keys(db).forEach(modelName => {
  if ('associate' in db[modelName]) {
    db[modelName].associate(db)
  }
})

// Add scopes
//
Object.keys(db).forEach(modelName => {
  if ('loadScope' in db[modelName]) {
    db[modelName].loadScope(db)
  }
})

// Link models based on associations that are based on scopes
//
Object.keys(db).forEach(modelName => {
  if ('scopeAssociate' in db[modelName]) {
    db[modelName].scopeAssociate(db)
  }
})

db.sequelize = sequelize
db.Sequelize = Sequelize

module.exports = db
