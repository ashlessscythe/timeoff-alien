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
    .filter(file => file.startsWith('backup_') && file.endsWith('.sql'))
  return files.sort().reverse()[0]
}

const inputFile = process.argv[2] || getLatestBackupFile()
if (!inputFile) {
  console.error('No backup file specified and no backups found')
  process.exit(1)
}

const inputPath = path.join(scriptDir, inputFile)
const compressedFile = inputPath.replace('.sql', '.dump')

console.log(`Processing file: ${inputPath}`)

// Convert to compressed format
const convertCommand = `pg_restore -f "${compressedFile}" --format=c "${inputPath}"`

exec(convertCommand, (error, stdout, stderr) => {
  if (error) {
    console.error(`Error converting to compressed format: ${error}`)
    return
  }
  console.log(`Converted to compressed format: ${compressedFile}`)

  // Restore from compressed format
  const restoreCommand = `pg_restore -d "${dbUrl}" -c -v "${compressedFile}"`

  exec(restoreCommand, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error restoring database: ${error}`)
      return
    }
    console.log(`Database restored successfully from ${compressedFile}`)
    console.log(`stdout: ${stdout}`)
    console.error(`stderr: ${stderr}`)

    // Optionally, remove the temporary compressed file
    fs.unlinkSync(compressedFile)
    console.log(`Temporary file removed: ${compressedFile}`)
  })
})
