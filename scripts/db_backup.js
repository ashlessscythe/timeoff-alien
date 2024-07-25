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
const defaultBackupFile = `backup_${timestamp}.sql`

const backupFile = process.argv[2] || defaultBackupFile
const backupPath = path.join(scriptDir, backupFile)

// Construct the pg_dump command for plaintext output
const command = `pg_dump "${dbUrl}" -F p -f "${backupPath}"`

console.log(`Creating backup: ${backupPath}`)

exec(command, (error, stdout, stderr) => {
  if (error) {
    console.error(`Error executing pg_dump: ${error}`)
    return
  }
  console.log(`Backup saved to: ${backupPath}`)
  console.log(`stdout: ${stdout}`)
  console.error(`stderr: ${stderr}`)
})
