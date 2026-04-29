'use strict'

const session = require('express-session')
const redis = require('redis')
const connectRedis = require('connect-redis')
const { Pool } = require('pg')
const connectPgSimple = require('connect-pg-simple')
const config = require('../config')

/**
 * Returns express-session middleware using Redis or Postgres (connect-pg-simple).
 */
function createSessionMiddleware() {
  const storeType = config.get('sessions:store')
  const secret = process.env.SESSION_SECRET || config.get('sessions:secret')
  const ttl = config.get('sessions:ttl')

  let store

  if (storeType === 'redis') {
    const RedisStore = connectRedis(session)
    const redisConfiguration = config.get('sessions:redis')
    const { host, port } = redisConfiguration
    if (!(host && port)) {
      throw new Error('Missing configuration for Redis to use with Sessions')
    }
    const redisClient = redis.createClient({ host, port })
    redisClient.on('error', err => {
      console.error('Redis session client error:', err)
    })
    store = new RedisStore({ client: redisClient })
  } else {
    const PgSession = connectPgSimple(session)
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5
    })
    store = new PgSession({
      pool,
      tableName: 'Sessions',
      createTableIfMissing: false
    })
  }

  return session({
    store,
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: ttl
    }
  })
}

module.exports = { createSessionMiddleware }
