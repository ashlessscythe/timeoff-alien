require('dotenv').config()

module.exports = {
  development: {
    url: process.env.DATABASE_URL,
    dialect: 'postgres',
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false // for self-signed certificates; set to true for verified certificates
      }
    }
  }
}
