'use strict'

const fs = require('fs')
const path = require('path')
const Sequelize = require('sequelize')
const env = process.env.NODE_ENV || 'development'

// Extract the useSSL flag from an environment variable
const useSSL = process.env.USE_SSL === 'true';
console.log('useSSL is:', useSSL)

const databaseConfig = {
  dialectOptions: {},
  logging: (process.env.DB_LOGGING === 'true' && console.log) || false,
  pool: {
    max: parseInt(process.env.DB_POOL_MAX) || 5,
    min: parseInt(process.env.DB_POOL_MIN) || 0,
    acquire: parseInt(process.env.DB_POOL_ACQUIRE) || 60000,
    idle: parseInt(process.env.DB_POOL_IDLE) || 10000
  }
};

// If SSL is required, configure dialectOptions for SSL
if (useSSL) {
  databaseConfig.dialectOptions.ssl = {
    require: process.env.DB_SSL_REQUIRE === 'true',
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' // Defaults to true unless explicitly set to 'false'
  };
}

// Initialize Sequelize with DATABASE_URL and the configuration
const sequelize = new Sequelize(process.env.DATABASE_URL, databaseConfig);

console.log('DB Config:', databaseConfig);
console.log('DB URL:', process.env.DATABASE_URL);

// Example of defining models
const db = {};

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
