require('dotenv').config()
const { exec } = require('child_process')
const path = require('path')
const fs = require('fs')

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  console.error('DATABASE_URL not found in .env file')
  process.exit(1)
}

const scriptDir = path.dirname(__filename)

function getLatestBackupFile() {
  const files = fs
    .readdirSync(scriptDir)
    .filter(
      file =>
        file.startsWith('backup_') && (file.endsWith('.dump') || file.endsWith('.sql'))
    )
  return files.sort().reverse()[0]
}

function resolveInputPath(arg) {
  const fallback = getLatestBackupFile()
  const input = arg || fallback
  if (!input) return null

  const direct = path.isAbsolute(input) ? input : path.join(scriptDir, input)
  if (fs.existsSync(direct)) return direct

  // Allow passing a basename without extension.
  if (!path.extname(direct)) {
    const dumpCandidate = `${direct}.dump`
    if (fs.existsSync(dumpCandidate)) return dumpCandidate
    const sqlCandidate = `${direct}.sql`
    if (fs.existsSync(sqlCandidate)) return sqlCandidate
  }
  return direct
}

const inputPath = resolveInputPath(process.argv[2])
if (!inputPath || !fs.existsSync(inputPath)) {
  console.error('No backup file found. Provide a filename/path, or create a backup first.')
  process.exit(1)
}

console.log(`Restoring from: ${inputPath}`)

const isDump = inputPath.endsWith('.dump')
const restoreCommand = isDump
  ? `pg_restore --clean --if-exists --no-owner --no-privileges -d "${dbUrl}" "${inputPath}"`
  : `psql "${dbUrl}" -v ON_ERROR_STOP=1 -f "${inputPath}"`

exec(restoreCommand, { shell: '/bin/bash' }, (error, stdout, stderr) => {
  if (stdout) console.log(stdout)
  if (stderr) console.error(stderr)
  if (error) {
    console.error(`Error restoring database: ${error.message}`)
    process.exitCode = typeof error.code === 'number' ? error.code : 1
    return
  }
  console.log('Database restore complete.')
})
