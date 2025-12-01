'use strict'

const crypto = require('crypto')
const Joi = require('joi')
const prisma = require('../../prisma/client')

const constructor_schema = Joi.object()
  .required()
  .keys({
    // No args needed, we use Prisma directly
  })

class EncryptedBackup {
  constructor(args = {}) {
    Joi.attempt(
      args,
      constructor_schema,
      'Failed to instantiate EncryptedBackup due to arguments validation'
    )

    this._encryptionKey = process.env.BACKUP_ENCRYPTION_KEY

    if (!this._encryptionKey) {
      throw new Error(
        'BACKUP_ENCRYPTION_KEY environment variable is required for encrypted backups'
      )
    }

    // Ensure key is 32 bytes (256 bits) for AES-256
    this._encryptionKey = crypto
      .createHash('sha256')
      .update(this._encryptionKey)
      .digest()
  }

  /**
   * Encrypt data using AES-256-GCM
   */
  encrypt(data) {
    const algorithm = 'aes-256-gcm'
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv(algorithm, this._encryptionKey, iv)

    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex')
    encrypted += cipher.final('hex')

    const authTag = cipher.getAuthTag()

    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      algorithm
    }
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  decrypt(encryptedData) {
    const algorithm = encryptedData.algorithm || 'aes-256-gcm'
    const iv = Buffer.from(encryptedData.iv, 'hex')
    const authTag = Buffer.from(encryptedData.authTag, 'hex')
    const decipher = crypto.createDecipheriv(algorithm, this._encryptionKey, iv)

    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return JSON.parse(decrypted)
  }

  /**
   * Export all database tables as encrypted JSON
   */
  async promiseFullBackup({ company }) {
    const backupData = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      company_id: company.id,
      company_name: company.name,
      tables: {}
    }

    // List of all Prisma models to backup (excluding SequelizeMeta and Sessions)
    // Using Prisma model names (camelCase)
    const modelsToBackup = [
      { name: 'companies', hasCompanyId: false }, // Company itself
      { name: 'users', hasCompanyId: true },
      { name: 'departments', hasCompanyId: true },
      { name: 'leave_types', hasCompanyId: true },
      { name: 'leaves', hasCompanyId: false }, // Has user_id which links to company
      { name: 'bank_holidays', hasCompanyId: true },
      { name: 'schedules', hasCompanyId: true },
      { name: 'comments', hasCompanyId: true },
      { name: 'audit', hasCompanyId: true },
      { name: 'email_audits', hasCompanyId: true },
      { name: 'user_allowance_adjustment', hasCompanyId: false }, // Has user_id
      { name: 'user_feeds', hasCompanyId: false }, // Has user_id
      { name: 'department_supervisors', hasCompanyId: false } // Has department_id
    ]

    // Backup each table
    for (const model of modelsToBackup) {
      try {
        let records = []

        if (model.name === 'companies') {
          // Backup the company itself
          const companyRecord = await prisma.companies.findUnique({
            where: { id: company.id }
          })
          records = companyRecord ? [companyRecord] : []
        } else if (model.hasCompanyId) {
          // Direct company_id filter
          records = await prisma[model.name].findMany({
            where: { company_id: company.id }
          })
        } else if (model.name === 'leaves') {
          // Leaves are linked via users
          records = await prisma.leaves.findMany({
            where: {
              users_leaves_user_idTousers: {
                company_id: company.id
              }
            }
          })
        } else if (model.name === 'user_allowance_adjustment') {
          // Linked via users
          records = await prisma.user_allowance_adjustment.findMany({
            where: {
              users: {
                company_id: company.id
              }
            }
          })
        } else if (model.name === 'user_feeds') {
          // Linked via users
          records = await prisma.user_feeds.findMany({
            where: {
              users: {
                company_id: company.id
              }
            }
          })
        } else if (model.name === 'department_supervisors') {
          // Linked via departments
          records = await prisma.department_supervisors.findMany({
            where: {
              departments: {
                company_id: company.id
              }
            }
          })
        }

        backupData.tables[model.name] = records
        console.log(
          `Backed up ${records.length} records from ${model.name} table`
        )
      } catch (error) {
        console.error(`Error backing up ${model.name}:`, error)
        // Continue with other tables even if one fails
        backupData.tables[model.name] = []
      }
    }

    // Encrypt the backup data
    const encrypted = this.encrypt(backupData)

    return {
      data: encrypted,
      metadata: {
        version: backupData.version,
        timestamp: backupData.timestamp,
        company_id: backupData.company_id,
        company_name: backupData.company_name,
        table_count: Object.keys(backupData.tables).length,
        total_records: Object.values(backupData.tables).reduce(
          (sum, records) => sum + records.length,
          0
        )
      }
    }
  }

  /**
   * Restore database from encrypted backup
   */
  async promiseRestore({ encryptedBackup, company, options = {} }) {
    const { dryRun = false, clearExisting = false } = options

    // Decrypt the backup
    let backupData
    try {
      backupData = this.decrypt(encryptedBackup)
    } catch (error) {
      throw new Error(
        `Failed to decrypt backup: ${
          error.message
        }. Please verify the encryption key matches.`
      )
    }

    // Validate backup structure
    if (!backupData.tables || !backupData.version) {
      throw new Error('Invalid backup format')
    }

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        tables: Object.keys(backupData.tables),
        recordCounts: Object.entries(backupData.tables).reduce(
          (acc, [table, records]) => {
            acc[table] = records.length
            return acc
          },
          {}
        )
      }
    }

    const results = {
      restored: {},
      errors: {}
    }

    // Define restore order based on dependencies
    // Tables must be restored in this order to satisfy foreign key constraints
    const restoreOrder = [
      'companies', // No dependencies
      'departments', // Depends on companies
      'leave_types', // Depends on companies
      'users', // Depends on companies and departments
      'bank_holidays', // Depends on companies
      'schedules', // Depends on companies and users
      'leaves', // Depends on users and leave_types
      'user_allowance_adjustment', // Depends on users
      'user_feeds', // Depends on users
      'comments', // Depends on companies and users
      'audit', // Depends on companies and users (by_user_id nullable)
      'email_audits', // Depends on companies and users
      'department_supervisors' // Depends on departments and users
    ]

    // Build ID mapping for users and departments (in case IDs change)
    const userIdMap = new Map() // old_user_id -> new_user_id
    const departmentIdMap = new Map() // old_dept_id -> new_dept_id

    // Clear existing data FIRST if requested (in reverse dependency order)
    if (clearExisting) {
      console.log('Clearing existing company data...')
      const clearOrder = [
        'department_supervisors', // Depends on departments and users
        'email_audits', // Depends on users and companies
        'audit', // Depends on users and companies
        'comments', // Depends on users and companies
        'user_feeds', // Depends on users
        'user_allowance_adjustment', // Depends on users
        'leaves', // MUST be before users and leave_types (has NO ACTION constraints)
        'schedules', // Depends on users and companies
        'bank_holidays', // Depends on companies
        'users', // Depends on departments and companies
        'leave_types', // Depends on companies
        'departments' // Depends on companies
      ]

      for (const tableName of clearOrder) {
        try {
          if (tableName === 'department_supervisors') {
            await prisma.department_supervisors.deleteMany({
              where: {
                departments: {
                  company_id: company.id
                }
              }
            })
          } else if (tableName === 'email_audits') {
            await prisma.email_audits.deleteMany({
              where: { company_id: company.id }
            })
          } else if (tableName === 'audit') {
            await prisma.audit.deleteMany({
              where: { company_id: company.id }
            })
          } else if (tableName === 'comments') {
            await prisma.comments.deleteMany({
              where: { company_id: company.id }
            })
          } else if (tableName === 'user_feeds') {
            await prisma.user_feeds.deleteMany({
              where: {
                users: {
                  company_id: company.id
                }
              }
            })
          } else if (tableName === 'user_allowance_adjustment') {
            await prisma.user_allowance_adjustment.deleteMany({
              where: {
                users: {
                  company_id: company.id
                }
              }
            })
          } else if (tableName === 'leaves') {
            // Delete leaves for users in this company - MUST be before users/leave_types
            await prisma.leaves.deleteMany({
              where: {
                users_leaves_user_idTousers: {
                  company_id: company.id
                }
              }
            })
          } else if (tableName === 'schedules') {
            await prisma.schedules.deleteMany({
              where: { company_id: company.id }
            })
          } else if (tableName === 'bank_holidays') {
            await prisma.bank_holidays.deleteMany({
              where: { company_id: company.id }
            })
          } else if (tableName === 'users') {
            await prisma.users.deleteMany({
              where: { company_id: company.id }
            })
          } else if (tableName === 'leave_types') {
            await prisma.leave_types.deleteMany({
              where: { company_id: company.id }
            })
          } else if (tableName === 'departments') {
            await prisma.departments.deleteMany({
              where: { company_id: company.id }
            })
          }
          console.log(`Cleared ${tableName}`)
        } catch (error) {
          console.error(`Error clearing ${tableName}:`, error)
          // Continue clearing other tables even if one fails
        }
      }
      console.log('Finished clearing existing data')
    }

    // Restore tables in dependency order
    for (const tableName of restoreOrder) {
      const records = backupData.tables[tableName]
      if (!records || records.length === 0) {
        results.restored[tableName] = 0
        continue
      }
      const prismaModelName = tableName

      if (!prisma[prismaModelName]) {
        console.warn(`Model ${tableName} not found, skipping...`)
        results.errors[tableName] = 'Model not found'
        continue
      }

      try {
        // Restore records
        if (records.length > 0) {
          // Update company_id and map foreign keys
          const recordsToInsert = records
            .map(record => {
              const newRecord = { ...record }

              // Update company_id for company-scoped models
              if (newRecord.company_id && tableName !== 'companies') {
                newRecord.company_id = company.id
              }

              // Map foreign key IDs based on dependency order
              if (tableName === 'users') {
                // Map department_id
                if (
                  newRecord.department_id &&
                  departmentIdMap.has(newRecord.department_id)
                ) {
                  newRecord.department_id = departmentIdMap.get(
                    newRecord.department_id
                  )
                }
              } else if (tableName === 'schedules') {
                // Map user_id (nullable)
                if (newRecord.user_id && userIdMap.has(newRecord.user_id)) {
                  newRecord.user_id = userIdMap.get(newRecord.user_id)
                } else if (newRecord.user_id) {
                  // User doesn't exist, set to null if allowed
                  newRecord.user_id = null
                }
              } else if (tableName === 'leaves') {
                // Map user_id and approver_id
                if (newRecord.user_id && userIdMap.has(newRecord.user_id)) {
                  newRecord.user_id = userIdMap.get(newRecord.user_id)
                } else if (newRecord.user_id) {
                  // Skip this record if user doesn't exist
                  return null
                }
                if (
                  newRecord.approver_id &&
                  userIdMap.has(newRecord.approver_id)
                ) {
                  newRecord.approver_id = userIdMap.get(newRecord.approver_id)
                } else if (newRecord.approver_id) {
                  newRecord.approver_id = null // nullable
                }
              } else if (
                tableName === 'user_allowance_adjustment' ||
                tableName === 'user_feeds'
              ) {
                // Map user_id
                if (newRecord.user_id && userIdMap.has(newRecord.user_id)) {
                  newRecord.user_id = userIdMap.get(newRecord.user_id)
                } else if (newRecord.user_id) {
                  // Skip if user doesn't exist
                  return null
                }
              } else if (
                tableName === 'comments' ||
                tableName === 'email_audits'
              ) {
                // Map user_id
                if (
                  newRecord.by_user_id &&
                  userIdMap.has(newRecord.by_user_id)
                ) {
                  newRecord.by_user_id = userIdMap.get(newRecord.by_user_id)
                } else if (newRecord.by_user_id) {
                  // Skip if user doesn't exist
                  return null
                }
                // Also handle user_id for email_audits
                if (
                  tableName === 'email_audits' &&
                  newRecord.user_id &&
                  userIdMap.has(newRecord.user_id)
                ) {
                  newRecord.user_id = userIdMap.get(newRecord.user_id)
                } else if (tableName === 'email_audits' && newRecord.user_id) {
                  return null
                }
              } else if (tableName === 'audit') {
                // Map by_user_id (nullable)
                if (
                  newRecord.by_user_id &&
                  userIdMap.has(newRecord.by_user_id)
                ) {
                  newRecord.by_user_id = userIdMap.get(newRecord.by_user_id)
                } else if (newRecord.by_user_id) {
                  newRecord.by_user_id = null // nullable
                }
              } else if (tableName === 'department_supervisors') {
                // Map department_id and user_id
                if (
                  newRecord.department_id &&
                  departmentIdMap.has(newRecord.department_id)
                ) {
                  newRecord.department_id = departmentIdMap.get(
                    newRecord.department_id
                  )
                } else if (newRecord.department_id) {
                  return null // Skip if department doesn't exist
                }
                if (newRecord.user_id && userIdMap.has(newRecord.user_id)) {
                  newRecord.user_id = userIdMap.get(newRecord.user_id)
                } else if (newRecord.user_id) {
                  return null // Skip if user doesn't exist
                }
              }

              // Remove Prisma-specific fields that shouldn't be restored
              delete newRecord.createdAt
              delete newRecord.updatedAt

              return newRecord
            })
            .filter(record => record !== null) // Remove skipped records

          // Use Prisma's createMany or upsert for each record
          // Note: Prisma doesn't have bulkCreate with updateOnDuplicate,
          // so we'll use upsert for each record
          let restoredCount = 0

          for (const record of recordsToInsert) {
            try {
              if (tableName === 'companies') {
                // Update company
                // If clearExisting is true, restore everything including name
                // Otherwise, preserve name and timestamps
                const { id, created_at, updated_at, ...companyData } = record

                // Only preserve name if NOT clearing existing data
                if (!clearExisting) {
                  delete companyData.name
                }

                await prisma.companies.update({
                  where: { id: company.id },
                  data: companyData
                })
                restoredCount++
              } else {
                // For other tables, try to create or update
                try {
                  // Try to create first
                  const created = await prisma[prismaModelName].create({
                    data: record
                  })

                  // Build ID mappings for users and departments
                  if (tableName === 'users' && record.id) {
                    userIdMap.set(record.id, created.id)
                  } else if (tableName === 'departments' && record.id) {
                    departmentIdMap.set(record.id, created.id)
                  }

                  restoredCount++
                } catch (err) {
                  // If it's a unique constraint error (P2002) or foreign key error (P2003), try to update
                  if (err.code === 'P2002' || err.code === 'P2003') {
                    // Try to find and update by ID
                    if (record.id !== undefined) {
                      try {
                        const updated = await prisma[prismaModelName].update({
                          where: { id: record.id },
                          data: record
                        })

                        // Build ID mappings
                        if (tableName === 'users' && record.id) {
                          userIdMap.set(record.id, updated.id)
                        } else if (tableName === 'departments' && record.id) {
                          departmentIdMap.set(record.id, updated.id)
                        }

                        restoredCount++
                      } catch (updateErr) {
                        // If update fails (e.g., record doesn't exist), skip it
                        console.warn(
                          `Skipping record in ${tableName} (ID: ${
                            record.id
                          }): ${updateErr.message}`
                        )
                      }
                    } else {
                      // No ID, can't update - skip
                      console.warn(
                        `Skipping record in ${tableName} (no ID): ${
                          err.message
                        }`
                      )
                    }
                  } else {
                    // Other error - log and skip
                    console.warn(
                      `Skipping record in ${tableName}: ${err.message}`
                    )
                  }
                }
              }
            } catch (error) {
              console.error(`Error restoring record in ${tableName}:`, error)
              // Continue with next record
            }
          }

          results.restored[tableName] = restoredCount
          console.log(`Restored ${restoredCount} records to ${tableName} table`)
        } else {
          results.restored[tableName] = 0
        }
      } catch (error) {
        console.error(`Error restoring ${tableName}:`, error)
        results.errors[tableName] = error.message
      }
    }

    return results
  }

  /**
   * Get unique fields for a model (for upsert operations)
   */
  _getUniqueFields(modelName) {
    const uniqueFieldsMap = {
      companies: ['id'],
      users: ['id'],
      departments: ['id'],
      leave_types: ['id'],
      leaves: ['id'],
      bank_holidays: ['id'],
      schedules: ['id'],
      comments: ['id'],
      audit: ['id'],
      email_audits: ['id'],
      user_allowance_adjustment: ['id'], // Has unique constraint on user_id + year
      user_feeds: ['id'],
      department_supervisors: ['department_id', 'user_id'] // Composite key
    }

    return uniqueFieldsMap[modelName] || ['id']
  }
}

module.exports = EncryptedBackup
