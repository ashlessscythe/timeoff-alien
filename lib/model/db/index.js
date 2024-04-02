'use strict'

const fs = require('fs')
const path = require('path')
const Sequelize = require('sequelize')
const env = process.env.NODE_ENV || 'development'
const env_var = process.env

const databaseConfig = {
  host: env_var.DB_HOST,
  database: env_var.DB_DATABASE,
  username: env_var.DB_USERNAME,
  password: env_var.DB_PASSWORD,

  dialect: env_var.DB_DIALECT,
  storage: env_var.DB_STORAGE,
  logging: (env_var.DB_LOGGING && console.log) || false,
  pool: {
    max: parseInt(env_var.DB_POOL_MAX) || 5,
    min: parseInt(env_var.DB_POOL_MIN) || 0,
    acquire: parseInt(env_var.DB_POOL_ACQUIRE) || 60000,
    idle: parseInt(env_var.DB_POOL_IDLE) || 10000
  },
  dialectOptions: {
    ssl: {
      require: env_var.DB_SSL_REQUIRE || false,
      rejectUnauthorized: env_var.DB_SSL_REJECT_UNAUTHORIZED || false
    }

  }
}
console.log("db config is:", databaseConfig)

const sequelize = env_var.DATABASE_URL
  ? new Sequelize(env_var.DATABASE_URL, databaseConfig)
  : new Sequelize(databaseConfig)
const db = {}

fs.readdirSync(__dirname)
  .filter(file => file.indexOf('.') !== 0 && file !== 'index.js')
  .forEach(file => {
    const model = sequelize.import(path.join(__dirname, file))
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
