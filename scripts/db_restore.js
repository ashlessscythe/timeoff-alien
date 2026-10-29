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

/**
 * Newer pg_dump majors may emit SET <guc> statements the restore target does
 * not recognize (e.g. transaction_timeout from PG17+ into PG16). pg_restore
 * still exits non-zero even when those are the only failures. Treat that class
 * of unknown-GUC noise as non-fatal so cross-minor restores remain usable.
 */
function onlyBenignUnknownGucErrors(stderr, errorMessage) {
  const text = `${stderr || ''}\n${errorMessage || ''}`
  if (!/unrecognized configuration parameter/i.test(text)) return false

  const unknownParams = [
    ...text.matchAll(/unrecognized configuration parameter "([^"]+)"/gi)
  ].map(match => match[1])
  if (unknownParams.length === 0) return false

  const benign = new Set([
    'transaction_timeout',
    'idle_session_timeout',
    'idle_in_transaction_session_timeout'
  ])
  if (!unknownParams.every(name => benign.has(name))) return false

  // Strip known-benign noise and refuse if anything else looks like a hard error.
  const remainder = text
    .split(/\r?\n/)
    .filter(line => {
      const trimmed = line.trim()
      if (!trimmed) return false
      if (/^pg_restore:\s*error:\s*could not execute query:/i.test(trimmed)) {
        return false
      }
      if (/^Command was:\s*SET\s+/i.test(trimmed)) return false
      if (/unrecognized configuration parameter/i.test(trimmed)) return false
      if (/^pg_restore:\s*warning:\s*errors ignored on restore:/i.test(trimmed)) {
        return false
      }
      if (/^Error restoring database:/i.test(trimmed)) return false
      if (/^Command failed:/i.test(trimmed)) return false
      if (/^pg_restore:\s*(connecting|processing|creating|dropping)/i.test(trimmed)) {
        return false
      }
      return /error|fatal|panic/i.test(trimmed)
    })

  return remainder.length === 0
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
    if (
      isDump &&
      onlyBenignUnknownGucErrors(stderr, error.message)
    ) {
      console.warn(
        'Ignoring benign unrecognized configuration parameter(s) from a newer pg_dump; restore otherwise succeeded.'
      )
      console.log('Database restore complete.')
      return
    }
    console.error(`Error restoring database: ${error.message}`)
    process.exitCode = typeof error.code === 'number' ? error.code : 1
    return
  }
  console.log('Database restore complete.')
})
