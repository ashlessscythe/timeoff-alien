require('dotenv').config()

module.exports = {
  development: {
    url: process.env.DATABASE_URL,
    dialect: process.env.DB_DIALECT || 'postgres',
    dialectOptions: {
      ssl: {
        require: process.env.DB_SSL_REQUIRE === 'true',
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' // Defaults to true unless explicitly set to 'false'
      }
    }
    // Additional config settings as needed
  },
  production: {
    url: process.env.DATABASE_URL,
    dialect: process.env.DB_DIALECT || 'postgres',
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false // Set to true if you have a proper SSL certificate
      }
    }
    // Additional production-specific settings
  }
  // Additional environment configurations as needed
}
