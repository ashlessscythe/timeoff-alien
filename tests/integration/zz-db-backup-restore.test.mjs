import { describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)

async function hasCommand(cmd) {
  try {
    await execFileAsync(cmd, ['--version'])
    return true
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.errno === 'ENOENT')) return false
    // Command exists but returned non-zero; assume present.
    return true
  }
}

async function resyncIdSequences(prisma) {
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
}

describe('db backup/restore scripts', () => {
  it('round-trips data via pg_dump custom format and pg_restore', async () => {
    if (!process.env.DATABASE_URL) {
      return
    }

    const [hasPgDump, hasPgRestore, hasPsql] = await Promise.all([
      hasCommand('pg_dump'),
      hasCommand('pg_restore'),
      hasCommand('psql')
    ])
    if (!hasPgDump || !hasPgRestore || !hasPsql) {
      return
    }

    const { PrismaClient } = require('@prisma/client')
    const prisma = new PrismaClient()

    const unique = `vitest-backup-restore-${Date.now()}`
    const now = new Date()

    const created = await prisma.companies.create({
      data: {
        name: unique,
        country: 'US',
        start_of_new_year: 1,
        share_all_absences: false,
        is_team_view_hidden: false,
        ldap_auth_enabled: false,
        date_format: 'YYYY-MM-DD',
        mode: 1,
        timezone: 'America/Denver',
        integration_api_enabled: false,
        carry_over: 0,
        created_at: now,
        updated_at: now,
        last_name_first: false,
        payroll_close_time: 10,
        first_day_of_week: 1
      }
    })
    expect(created).toBeTruthy()

    const scriptDir = path.join(process.cwd(), 'scripts')
    const baseName = `backup_${unique}`
    const dumpPath = path.join(scriptDir, `${baseName}.dump`)
    const sqlPath = path.join(scriptDir, `${baseName}.sql`)

    try {
      await execFileAsync(process.execPath, ['scripts/db_backup.js', baseName], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 120000
      })
      expect(fs.existsSync(dumpPath)).toBe(true)

      await prisma.companies.delete({ where: { id: created.id } })
      const missing = await prisma.companies.findFirst({
        where: { name: unique }
      })
      expect(missing).toBe(null)

      await prisma.$disconnect()

      await execFileAsync(process.execPath, ['scripts/db_restore.js', `${baseName}.dump`], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 180000
      })

      const prisma2 = new PrismaClient()
      try {
        const restored = await prisma2.companies.findFirst({
          where: { name: unique }
        })
        expect(restored).toBeTruthy()
        await resyncIdSequences(prisma2)
      } finally {
        await prisma2.$disconnect()
      }
    } finally {
      // best-effort cleanup
      try {
        if (fs.existsSync(dumpPath)) fs.unlinkSync(dumpPath)
      } catch (_e) {}
      try {
        if (fs.existsSync(sqlPath)) fs.unlinkSync(sqlPath)
      } catch (_e) {}
      try {
        await prisma.$disconnect()
      } catch (_e) {}
    }
  }, 240000)
})

