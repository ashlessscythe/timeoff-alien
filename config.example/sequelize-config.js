require('dotenv').config()

module.exports = {
  development: {
    url: process.env.DATABASE_URL,
    dialect: process.env.DB_DIALECT || 'postgres'
    // Additional config settings as needed
  },
  production: {
    url: process.env.DATABASE_URL,
    dialect: process.env.DB_DIALECT || 'postgres'
    // Additional production-specific settings
  }
  // Additional environment configurations as needed
}
