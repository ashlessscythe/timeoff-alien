'use strict'

// Cross-platform production start (avoids Unix-only NODE_ENV=... prefixes).
process.env.NODE_ENV = 'production'
require('../bin/wwww')
