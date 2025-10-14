const session = require('express-session')
const redis = require('redis')
const connectRedis = require('connect-redis')

const config = require('../config')

const createSessionMiddleware = ({ sequelizeDb }) => {
  let store

  const storageType = config.get('sessions:store')

  if (storageType === 'redis') {
    const RedisStore = connectRedis(session)

    const redisConfiguration = config.get('sessions:redis')
    const { host, port } = redisConfiguration
    if (!(host && port)) {
      throw new Error('Missing configuration for Redis to use with Sessions')
    }
    const redisClient = redis.createClient({ host, port })

    redisClient.on('error', err => {
      throw new Error(`Failed to connect to Redis: ${err}`)
    })
    redisClient.on('connect', err => {
      if (err) {
        throw new Error(`Failed to connect to Redis: ${err}`)
      }
      console.log('Connected to redis successfully')
    })

    store = new RedisStore({ client: redisClient })
  } else {
    // Default to memory store if no Redis configuration
    console.log('Using memory store for sessions')
  }

  return session({
    store,
    secret: config.get('sessions:secret'),
    resave: false,
    saveUninitialized: false
  })
}

module.exports = createSessionMiddleware
