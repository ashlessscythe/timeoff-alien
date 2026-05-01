'use strict'

const path = require('path')
const dotenv = require('dotenv')
const { execSync } = require('child_process')

/**
 * Stale Postgres sequences (e.g. after restores) cause "Unique constraint failed on (id)"
 * on INSERT … RETURNING id. Resync common tables used during registration.
 */
async function resyncIdSequences() {
  const { PrismaClient } = require('@prisma/client')
  const prisma = new PrismaClient()
  const tables = [
    'companies',
    'departments',
    'users',
    'leave_types',
    'leaves',
    'bank_holidays',
    'schedules',
    'comments',
    'audit',
    'email_audits',
    'user_feeds',
    'user_messages',
    'user_allowance_adjustment'
  ]
  try {
    for (const t of tables) {
      try {
        await prisma.$executeRawUnsafe(`
          SELECT setval(
            pg_get_serial_sequence('${t}', 'id'),
            (SELECT COALESCE(MAX(id), 1) FROM "${t}")
          )
        `)
      } catch (_e) {
        /* table may lack a serial id sequence */
      }
    }
  } finally {
    await prisma.$disconnect()
  }
}

module.exports = async function globalSetup() {
  const envPath = path.join(__dirname, '..', '.env.test')
  dotenv.config({ path: envPath, override: true })

  if (!process.env.DATABASE_URL) {
    console.warn(
      '[vitest globalSetup] DATABASE_URL not set (copy .env.test.example to .env.test). Skipping prisma migrate deploy.'
    )
    return
  }

  const root = path.join(__dirname, '..')
  try {
    execSync('npx prisma migrate deploy', {
      stdio: 'inherit',
      env: process.env,
      cwd: root
    })
  } catch (err) {
    console.warn(
      '[vitest globalSetup] prisma migrate deploy failed (continuing tests):',
      err && err.message ? err.message : err
    )
  }

  try {
    await resyncIdSequences()
  } catch (err) {
    console.warn(
      '[vitest globalSetup] id sequence resync failed (continuing tests):',
      err && err.message ? err.message : err
    )
  }
}
