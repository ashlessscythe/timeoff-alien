require('dotenv').config()
const { exec } = require('child_process')
const path = require('path')

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  console.error('DATABASE_URL not found in .env file')
  process.exit(1)
}

const scriptDir = path.dirname(__filename)
const timestamp = new Date().toISOString().replace(/:/g, '-')
const defaultBackupFile = `backup_${timestamp}`
const backupFile = process.argv[2] || defaultBackupFile
const backupPath = path.join(scriptDir, backupFile)

// Construct the pg_dump commands
const command1 = `pg_dump "${dbUrl}" -F p --no-owner --no-privileges -f "${backupPath}.sql"`
const command2 = `pg_dump "${dbUrl}" -F c --no-owner --no-privileges -f "${backupPath}.dump"`

console.log(`Creating plaintext backup: ${backupPath}.sql`)
exec(command1, (error, stdout, stderr) => {
  if (error) {
    console.error(`Error executing pg_dump for plaintext backup: ${error.message}`)
    console.error(`stderr: ${stderr}`)
    return
  }
  console.log(`Plaintext backup saved to: ${backupPath}.sql`)
  console.log(`stdout: ${stdout}`)

  // After the first command completes, run the second command
  console.log(`Creating compressed backup: ${backupPath}.dump`)
  exec(command2, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error executing pg_dump for compressed backup: ${error.message}`)
      console.error(`stderr: ${stderr}`)
      return
    }
    console.log(`Compressed backup saved to: ${backupPath}.dump`)
    console.log(`stdout: ${stdout}`)
  })
})