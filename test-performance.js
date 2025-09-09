#!/usr/bin/env node

/**
 * Performance testing script to compare Sequelize vs Prisma implementations
 */

const http = require('http')
const { performance } = require('perf_hooks')

const BASE_URL = 'http://localhost:3000'
const TEST_ROUTES = [
  { name: 'Sequelize', path: '/users/' },
  { name: 'Prisma', path: '/users-prisma/' }
]

async function makeRequest(url) {
  return new Promise((resolve, reject) => {
    const startTime = performance.now()

    const req = http.get(url, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        const endTime = performance.now()
        const duration = endTime - startTime

        resolve({
          statusCode: res.statusCode,
          duration: duration,
          contentLength: data.length,
          headers: res.headers
        })
      })
    })

    req.on('error', (error) => {
      reject(error)
    })

    req.setTimeout(30000, () => {
      req.destroy()
      reject(new Error('Request timeout'))
    })
  })
}

async function runPerformanceTest() {
  console.log('🚀 Starting performance comparison between Sequelize and Prisma...\n')

  const results = {}

  for (const route of TEST_ROUTES) {
    console.log(`Testing ${route.name} implementation...`)
    const times = []
    const errors = []

    // Run 5 requests for each implementation
    for (let i = 0; i < 5; i++) {
      try {
        const result = await makeRequest(`${BASE_URL}${route.path}`)
        times.push(result.duration)
        console.log(`  Request ${i + 1}: ${result.duration.toFixed(2)}ms (${result.statusCode})`)
      } catch (error) {
        errors.push(error.message)
        console.log(`  Request ${i + 1}: ERROR - ${error.message}`)
      }

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    if (times.length > 0) {
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length
      const minTime = Math.min(...times)
      const maxTime = Math.max(...times)

      results[route.name] = {
        average: avgTime,
        min: minTime,
        max: maxTime,
        times: times,
        errors: errors.length
      }

      console.log(`  Average: ${avgTime.toFixed(2)}ms`)
      console.log(`  Min: ${minTime.toFixed(2)}ms`)
      console.log(`  Max: ${maxTime.toFixed(2)}ms`)
      console.log(`  Errors: ${errors.length}\n`)
    } else {
      console.log(`  All requests failed for ${route.name}\n`)
    }
  }

  // Compare results
  if (results.Sequelize && results.Prisma) {
    console.log('📊 Performance Comparison:')
    console.log('========================')

    const sequelizeAvg = results.Sequelize.average
    const prismaAvg = results.Prisma.average
    const improvement = ((sequelizeAvg - prismaAvg) / sequelizeAvg) * 100

    console.log(`Sequelize Average: ${sequelizeAvg.toFixed(2)}ms`)
    console.log(`Prisma Average:    ${prismaAvg.toFixed(2)}ms`)

    if (improvement > 0) {
      console.log(`✅ Prisma is ${improvement.toFixed(1)}% faster than Sequelize`)
    } else {
      console.log(`❌ Sequelize is ${Math.abs(improvement).toFixed(1)}% faster than Prisma`)
    }

    console.log('\nDetailed Results:')
    console.log('-----------------')
    Object.entries(results).forEach(([name, data]) => {
      console.log(`${name}:`)
      console.log(`  Times: ${data.times.map(t => t.toFixed(2)).join(', ')}ms`)
      console.log(`  Errors: ${data.errors}`)
    })
  }
}

// Check if server is running
async function checkServer() {
  try {
    await makeRequest(`${BASE_URL}/`)
    return true
  } catch (error) {
    return false
  }
}

async function main() {
  console.log('🔍 Checking if server is running...')

  const serverRunning = await checkServer()
  if (!serverRunning) {
    console.log('❌ Server is not running. Please start the server first:')
    console.log('   npm start')
    console.log('   or')
    console.log('   node app.js')
    process.exit(1)
  }

  console.log('✅ Server is running\n')

  await runPerformanceTest()
}

main().catch(console.error)
