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

const getLatestBackupFile = () => {
  const files = fs
    .readdirSync(scriptDir)
    .filter(file => file.startsWith('backup_') && file.endsWith('.dump'))
  return files.sort().reverse()[0]
}

const inputFile = process.argv[2] || getLatestBackupFile()
if (!inputFile) {
  console.error('No backup file specified and no backups found')
  process.exit(1)
}

const inputPath = path.join(scriptDir, inputFile)
const compressedFile = inputPath

console.log(`Processing file: ${inputPath}`)

// Restore from compressed format
// const restoreCommand = `pg_restore -d "${dbUrl}" "${compressedFile}"`
const restoreCommand = `pg_restore --clean --if-exists --no-owner --no-privileges -d "${dbUrl}" "${compressedFile}"`

exec(restoreCommand, { shell: '/bin/bash' }, (error, stdout, stderr) => {
  if (error) {
    console.error(`Error restoring database: ${error.message}`);
    console.error(`Exit code: ${error.code}`);
    console.error(`Signal: ${error.signal}`);
  }
  console.log(`stdout: ${stdout}`);
  console.error(`stderr: ${stderr}`);
});
