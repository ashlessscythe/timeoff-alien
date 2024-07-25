const { exec } = require('child_process')
const path = require('path')
const util = require('util')

const execPromise = util.promisify(exec)

async function compressSql(inputFile) {
  const baseName = path.basename(inputFile, '.sql')
  const outputFile = `${baseName}.dump`
  const tempDb = `temp_db_${Date.now()}`

  try {
    console.log(`Creating temporary database: ${tempDb}`)
    await execPromise(`createdb ${tempDb}`)

    console.log(`Importing SQL into temporary database`)
    await execPromise(`psql ${tempDb} < ${inputFile}`)

    console.log(`Creating compressed dump`)
    await execPromise(`pg_dump -Fc ${tempDb} > ${outputFile}`)

    console.log(`Dropping temporary database`)
    await execPromise(`dropdb ${tempDb}`)

    console.log(`Compressed dump created: ${outputFile}`)
  } catch (error) {
    console.error(`An error occurred: ${error.message}`)
  }
}

// Check if a file argument is provided
if (process.argv.length < 3) {
  console.error('Please provide the SQL file as an argument.')
  process.exit(1)
}

const inputFile = process.argv[2]
compressSql(inputFile)
