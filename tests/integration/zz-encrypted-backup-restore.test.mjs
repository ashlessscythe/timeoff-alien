import { describe, it, expect } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import { createAgent, registerCompanyAndAdmin } from '../support/http.mjs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')
const EncryptedBackup = require('../../lib/model/company/encrypted_backup.js')

describe('EncryptedBackup', () => {
  it('creates encrypted backup and supports dry-run restore', async () => {
    if (!process.env.DATABASE_URL) return

    process.env.BACKUP_ENCRYPTION_KEY =
      process.env.BACKUP_ENCRYPTION_KEY || 'vitest-backup-key'

    const agent = createAgent(app)
    const { companyName } = await registerCompanyAndAdmin(agent)

    const company = await prisma.companies.findFirst({
      where: { name: companyName }
    })
    expect(company).toBeTruthy()

    const eb = new EncryptedBackup()
    const backup = await eb.promiseFullBackup({ company })

    expect(backup).toBeTruthy()
    expect(backup.data).toBeTruthy()
    expect(backup.data.encrypted).toMatch(/[0-9a-f]+/i)
    expect(backup.data.iv).toMatch(/[0-9a-f]+/i)
    expect(backup.data.authTag).toMatch(/[0-9a-f]+/i)
    expect(backup.metadata.company_id).toBe(company.id)
    expect(backup.metadata.table_count).toBeGreaterThan(0)

    const dryRun = await eb.promiseRestore({
      encryptedBackup: backup.data,
      company,
      options: { dryRun: true }
    })
    expect(dryRun.success).toBe(true)
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.tables).toContain('companies')
    expect(dryRun.tables).toContain('users')
    expect(dryRun.recordCounts.companies).toBe(1)
    expect(dryRun.recordCounts.departments).toBeGreaterThan(0)
    expect(dryRun.recordCounts.leave_types).toBeGreaterThan(0)
    expect(dryRun.recordCounts.users).toBeGreaterThan(0)
  })

  it('restores company-scoped data with clearExisting and fails with wrong key', async () => {
    if (!process.env.DATABASE_URL) return

    process.env.BACKUP_ENCRYPTION_KEY =
      process.env.BACKUP_ENCRYPTION_KEY || 'vitest-backup-key'

    const agent = createAgent(app)
    const { companyName } = await registerCompanyAndAdmin(agent)

    const company = await prisma.companies.findFirst({
      where: { name: companyName }
    })
    expect(company).toBeTruthy()

    const beforeUsers = await prisma.users.count({
      where: { company_id: company.id }
    })
    const beforeDepartments = await prisma.departments.count({
      where: { company_id: company.id }
    })
    const beforeLeaveTypes = await prisma.leave_types.count({
      where: { company_id: company.id }
    })
    expect(beforeUsers).toBeGreaterThan(0)
    expect(beforeDepartments).toBeGreaterThan(0)
    expect(beforeLeaveTypes).toBeGreaterThan(0)

    const eb = new EncryptedBackup()
    const backup = await eb.promiseFullBackup({ company })

    // Prove clearExisting actually clears: add a sentinel row AFTER backup.
    const sentinelDeptName = `ZZZ Sentinel Dept ${Date.now()}`
    const sentinelDept = await prisma.departments.create({
      data: {
        company_id: company.id,
        name: sentinelDeptName,
        allowance: 20,
        personal: 0,
        include_public_holidays: true,
        is_accrued_allowance: false,
        allowed_increments: '["full_day","half_day"]',
        created_at: new Date(),
        updated_at: new Date()
      }
    })
    expect(sentinelDept).toBeTruthy()

    // Ensure the restore path is actually doing work: clear all company-scoped rows it can.
    const restoreRes = await eb.promiseRestore({
      encryptedBackup: backup.data,
      company,
      options: { clearExisting: true }
    })
    expect(restoreRes).toBeTruthy()
    expect(restoreRes.errors).toBeTruthy()

    const sentinelAfter = await prisma.departments.findFirst({
      where: { id: sentinelDept.id }
    })
    expect(sentinelAfter).toBe(null)

    const afterUsers = await prisma.users.count({
      where: { company_id: company.id }
    })
    const afterDepartments = await prisma.departments.count({
      where: { company_id: company.id }
    })
    const afterLeaveTypes = await prisma.leave_types.count({
      where: { company_id: company.id }
    })
    expect(afterUsers).toBeGreaterThan(0)
    expect(afterDepartments).toBeGreaterThan(0)
    expect(afterLeaveTypes).toBeGreaterThan(0)

    // The restore uses createMany(skipDuplicates) and may insert the same number,
    // but shouldn't result in empty core tables.
    expect(afterUsers).toBeGreaterThanOrEqual(1)
    expect(afterDepartments).toBeGreaterThanOrEqual(1)
    expect(afterLeaveTypes).toBeGreaterThanOrEqual(1)

    // Wrong key should fail decryption.
    const prev = process.env.BACKUP_ENCRYPTION_KEY
    process.env.BACKUP_ENCRYPTION_KEY = 'wrong-key'
    try {
      const ebWrong = new EncryptedBackup()
      await expect(
        ebWrong.promiseRestore({
          encryptedBackup: backup.data,
          company,
          options: { dryRun: true }
        })
      ).rejects.toThrow(/decrypt|encryption key/i)
    } finally {
      process.env.BACKUP_ENCRYPTION_KEY = prev
    }
  }, 120000)
})

