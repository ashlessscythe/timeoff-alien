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

    // Build ID mapping for users, departments, and leave_types (in case IDs change)
    const userIdMap = new Map() // old_user_id -> new_user_id
    const departmentIdMap = new Map() // old_dept_id -> new_dept_id
    const leaveTypeIdMap = new Map() // old_leave_type_id -> new_leave_type_id

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
          const originalCount = records.length
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
                // Map user_id, approver_id, and leave_type_id
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
                if (newRecord.leave_type_id) {
                  if (leaveTypeIdMap.has(newRecord.leave_type_id)) {
                    newRecord.leave_type_id = leaveTypeIdMap.get(
                      newRecord.leave_type_id
                    )
                  } else {
                    // Skip this record if leave_type doesn't exist in map
                    // This will be logged below
                    return null
                  }
                } else {
                  // leave_type_id is required, so skip if missing
                  return null
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

          const filteredCount = originalCount - recordsToInsert.length
          if (filteredCount > 0 && tableName === 'leaves') {
            console.log(
              `Filtered out ${filteredCount} leaves records due to missing foreign key mappings (out of ${originalCount} total)`
            )
            if (leaveTypeIdMap.size === 0) {
              console.warn(
                'WARNING: leaveTypeIdMap is empty! Leave types may not have been restored or mapped correctly.'
              )
            } else {
              // Log sample of leave_type_ids from backup that weren't found in map
              const sampleMissingIds = records
                .slice(0, 5)
                .map(r => r.leave_type_id)
                .filter(id => id && !leaveTypeIdMap.has(id))
              if (sampleMissingIds.length > 0) {
                console.warn(
                  `Sample leave_type_ids from backup not found in map: ${sampleMissingIds.join(
                    ', '
                  )}`
                )
                console.log(
                  `Available leave_type_id mappings: ${Array.from(
                    leaveTypeIdMap.keys()
                  )
                    .slice(0, 10)
                    .join(', ')}`
                )
              }
            }
          }

          // Use bulk operations for better performance with large datasets
          let restoredCount = 0

          if (tableName === 'companies') {
            // Update company (single record)
            const {
              id,
              created_at,
              updated_at,
              ...companyData
            } = recordsToInsert[0]

            // Only preserve name if NOT clearing existing data
            if (!clearExisting) {
              delete companyData.name
            }

            await prisma.companies.update({
              where: { id: company.id },
              data: companyData
            })
            restoredCount = 1
          } else if (
            tableName === 'users' ||
            tableName === 'departments' ||
            tableName === 'leave_types'
          ) {
            // For users and departments, we need to build ID mappings
            // Use bulk insert with batch processing and ID mapping
            const BATCH_SIZE = 1000
            const oldIdToRecord = new Map(
              recordsToInsert.filter(r => r.id).map(r => [r.id, r])
            )

            // Process in batches
            for (let i = 0; i < recordsToInsert.length; i += BATCH_SIZE) {
              const batch = recordsToInsert.slice(i, i + BATCH_SIZE)

              // Remove id and camelCase Prisma fields, but preserve snake_case timestamps
              const batchForInsert = batch.map(
                ({ id, createdAt, updatedAt, ...rest }) => rest
              )

              try {
                // Bulk insert
                await prisma[prismaModelName].createMany({
                  data: batchForInsert,
                  skipDuplicates: true
                })
              } catch (err) {
                console.warn(
                  `Error in bulk insert for ${tableName} batch ${i /
                    BATCH_SIZE +
                    1}:`,
                  err.message
                )
                // Fallback to individual inserts for this batch
                for (const record of batch) {
                  try {
                    const {
                      id: oldId,
                      createdAt,
                      updatedAt,
                      ...recordForInsert
                    } = record
                    const created = await prisma[prismaModelName].create({
                      data: recordForInsert
                    })
                    if (oldId) {
                      if (tableName === 'users') {
                        userIdMap.set(oldId, created.id)
                      } else if (tableName === 'departments') {
                        departmentIdMap.set(oldId, created.id)
                      } else if (tableName === 'leave_types') {
                        leaveTypeIdMap.set(oldId, created.id)
                      }
                    }
                    restoredCount++
                  } catch (individualErr) {
                    if (individualErr.code !== 'P2002') {
                      // Skip duplicate errors
                      console.warn(
                        `Skipping record in ${tableName}: ${
                          individualErr.message
                        }`
                      )
                    }
                  }
                }
                continue
              }
            }

            // Build ID mappings by querying back the inserted/existing records
            // Match by unique fields (email for users, name+company_id for departments)
            // This handles both newly inserted records and existing records (when clearExisting=false)
            if (tableName === 'users' && oldIdToRecord.size > 0) {
              const emails = Array.from(oldIdToRecord.values())
                .map(r => r.email)
                .filter(Boolean)

              if (emails.length > 0) {
                // Query all users with these emails (includes both newly inserted and existing)
                const allUsers = await prisma.users.findMany({
                  where: {
                    company_id: company.id,
                    email: { in: emails }
                  },
                  select: { id: true, email: true }
                })

                // Build mapping: old_id -> new_id based on email
                const emailToOldId = new Map(
                  Array.from(oldIdToRecord.entries())
                    .filter(([_, r]) => r.email)
                    .map(([oldId, r]) => [r.email, oldId])
                )

                for (const user of allUsers) {
                  const oldId = emailToOldId.get(user.email)
                  if (oldId) {
                    userIdMap.set(oldId, user.id)
                  }
                }
              }
            } else if (tableName === 'departments' && oldIdToRecord.size > 0) {
              const names = Array.from(oldIdToRecord.values())
                .map(r => r.name)
                .filter(Boolean)

              if (names.length > 0) {
                // Query all departments with these names (includes both newly inserted and existing)
                const allDepartments = await prisma.departments.findMany({
                  where: {
                    company_id: company.id,
                    name: { in: names }
                  },
                  select: { id: true, name: true }
                })

                // Build mapping: old_id -> new_id based on name
                const nameToOldId = new Map(
                  Array.from(oldIdToRecord.entries())
                    .filter(([_, r]) => r.name)
                    .map(([oldId, r]) => [r.name, oldId])
                )

                for (const dept of allDepartments) {
                  const oldId = nameToOldId.get(dept.name)
                  if (oldId) {
                    departmentIdMap.set(oldId, dept.id)
                  }
                }
              }
            } else if (tableName === 'leave_types' && oldIdToRecord.size > 0) {
              const names = Array.from(oldIdToRecord.values())
                .map(r => r.name)
                .filter(Boolean)

              if (names.length > 0) {
                // Query all leave_types with these names (includes both newly inserted and existing)
                const allLeaveTypes = await prisma.leave_types.findMany({
                  where: {
                    company_id: company.id,
                    name: { in: names }
                  },
                  select: { id: true, name: true }
                })

                // Build mapping: old_id -> new_id based on name
                const nameToOldId = new Map(
                  Array.from(oldIdToRecord.entries())
                    .filter(([_, r]) => r.name)
                    .map(([oldId, r]) => [r.name, oldId])
                )

                for (const leaveType of allLeaveTypes) {
                  const oldId = nameToOldId.get(leaveType.name)
                  if (oldId) {
                    leaveTypeIdMap.set(oldId, leaveType.id)
                  }
                }

                console.log(
                  `Built ${
                    leaveTypeIdMap.size
                  } leave_type ID mappings (queried ${
                    allLeaveTypes.length
                  } leave_types from ${names.length} names)`
                )
              }
            }

            restoredCount = recordsToInsert.length
          } else {
            // For other tables, use bulk insert with batching
            const BATCH_SIZE = 1000

            for (let i = 0; i < recordsToInsert.length; i += BATCH_SIZE) {
              const batch = recordsToInsert.slice(i, i + BATCH_SIZE)

              // Remove id and camelCase Prisma fields, but preserve snake_case timestamps
              const batchForInsert = batch.map(
                ({ id, createdAt, updatedAt, ...rest }) => rest
              )

              try {
                await prisma[prismaModelName].createMany({
                  data: batchForInsert,
                  skipDuplicates: true
                })
                restoredCount += batch.length
              } catch (err) {
                console.warn(
                  `Error in bulk insert for ${tableName} batch ${i /
                    BATCH_SIZE +
                    1}:`,
                  err.message
                )
                // Fallback to individual inserts for this batch if bulk fails
                for (const record of batch) {
                  try {
                    const {
                      id,
                      createdAt,
                      updatedAt,
                      ...recordForInsert
                    } = record
                    await prisma[prismaModelName].create({
                      data: recordForInsert
                    })
                    restoredCount++
                  } catch (individualErr) {
                    // Skip duplicates and other errors
                    if (individualErr.code !== 'P2002') {
                      console.warn(
                        `Skipping record in ${tableName}: ${
                          individualErr.message
                        }`
                      )
                    }
                  }
                }
              }
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
