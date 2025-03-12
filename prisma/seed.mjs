import { faker } from '@faker-js/faker'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import fs from 'fs'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

const prisma = new PrismaClient()

// Password requirements following NIST guidelines
const PASSWORD_MIN_LENGTH = 12
const PASSWORD_MAX_LENGTH = 128
const SALT_ROUNDS = 12

// Function to generate a secure password that meets requirements
function generateSecurePassword() {
  const length = faker.number.int({
    min: PASSWORD_MIN_LENGTH,
    max: PASSWORD_MAX_LENGTH
  })
  const chars =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*'
  let password = ''
  for (let i = 0; i < length; i++) {
    password += faker.helpers.arrayElement(chars.split(''))
  }
  return password
}

// Default configuration
const DEFAULT_CONFIG = {
  departmentCount: 5,
  userCount: 10,
  leavesMultiplier: 3,
  companyId: 1,
  dateRange: {
    from: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), // 45 days ago
    to: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000) // 45 days from now
  },
  bankHolidayCount: 8, // Standard number of bank holidays
  customSchedulePercent: 30 // % of users that get custom schedules
}

// Fun bank holiday names for each month
const HOLIDAY_NAMES = {
  1: ["New Year's Day", 'Winter Blues Break'],
  2: ["Valentine's Break", 'Groundhog Day Off'],
  3: ['Spring Equinox Holiday', "St. Patrick's Day"],
  4: ["April Fools' Holiday", 'Spring Break'],
  5: ['May Day', 'Memorial Day'],
  6: ['Summer Solstice Break', 'Midsummer Holiday'],
  7: ['Independence Day', 'Summer Vacation Day'],
  8: ['Summer Bank Holiday', 'Late Summer Break'],
  9: ['Labor Day', 'Autumn Equinox Break'],
  10: ['Halloween Holiday', 'October Fest Break'],
  11: ['Veterans Day', 'Thanksgiving Break'],
  12: ['Winter Holiday', "New Year's Eve"]
}

// Hash password using bcrypt
function hashifyPassword(password) {
  return bcrypt.hashSync(password, SALT_ROUNDS)
}

const argv = yargs(hideBin(process.argv))
  .option('clear', {
    type: 'boolean',
    default: false,
    description: 'Clear all data before seeding'
  })
  .option('use-faker', {
    type: 'number',
    description: 'Number of associates to create (alias for --user-count)'
  })
  .option('user-count', {
    type: 'number',
    description: 'Number of associates to create'
  })
  .option('leaves-multiplier', {
    type: 'number',
    description: 'Multiplier for the number of leaves per associate'
  })
  .option('department-count', {
    type: 'number',
    description: 'Count of departments to create by default'
  })
  .option('company-id', {
    type: 'number',
    description: 'Company ID to use for seeding data'
  })
  .option('create-default-user', {
    type: 'boolean',
    default: false,
    description: 'Create default user (bob@local.eml) with password "bob"'
  })
  .option('uaa', {
    type: 'string',
    description: 'Path to CSV file containing user allowance adjustments'
  })
  .option('date-from', {
    type: 'string',
    description: 'Start date for leave records (YYYY-MM-DD)'
  })
  .option('date-to', {
    type: 'string',
    description: 'End date for leave records (YYYY-MM-DD)'
  })
  .option('bank-holiday-count', {
    type: 'number',
    description: 'Number of bank holidays to create'
  })
  .option('custom-schedule-percent', {
    type: 'number',
    description: 'Percentage of users that get custom schedules (0-100)'
  }).argv

async function clearDatabase() {
  console.log('Clearing database...')

  // Delete dependent tables first (child tables)
  await prisma.department_supervisors.deleteMany()
  await prisma.leaves.deleteMany()
  await prisma.user_allowance_adjustment.deleteMany()
  await prisma.user_feeds.deleteMany()
  await prisma.email_audits.deleteMany()
  await prisma.comments.deleteMany()
  await prisma.audit.deleteMany()
  await prisma.user_messages.deleteMany()

  // Delete from middle-level tables
  await prisma.schedules.deleteMany()
  await prisma.departments.deleteMany()
  await prisma.leave_types.deleteMany()
  await prisma.bank_holidays.deleteMany()
  await prisma.users.deleteMany()

  // Delete from parent tables
  await prisma.companies.deleteMany()

  // Delete unrelated tables last (no FKs)
  await prisma.sequelizeMeta.deleteMany()
  await prisma.sessions.deleteMany()

  console.log('Database cleared successfully')
}

async function main() {
  // Parse date range from arguments or use defaults
  const dateRange = {
    from: argv.dateFrom
      ? new Date(argv.dateFrom)
      : DEFAULT_CONFIG.dateRange.from,
    to: argv.dateTo ? new Date(argv.dateTo) : DEFAULT_CONFIG.dateRange.to
  }

  // Validate date range
  if (isNaN(dateRange.from.getTime()) || isNaN(dateRange.to.getTime())) {
    throw new Error('Invalid date format. Use YYYY-MM-DD')
  }

  // Get configuration, using defaults for missing values
  const config = {
    clear: argv.clear || false,
    companyId: argv.companyId || DEFAULT_CONFIG.companyId,
    associateCount: argv.userCount || argv.useFaker || DEFAULT_CONFIG.userCount,
    leavesMultiplier: argv.leavesMultiplier || DEFAULT_CONFIG.leavesMultiplier,
    departmentCount: argv.departmentCount || DEFAULT_CONFIG.departmentCount,
    createDefaultUser: argv.createDefaultUser || false,
    uaaFile: argv.uaa,
    dateRange,
    bankHolidayCount: argv.bankHolidayCount || DEFAULT_CONFIG.bankHolidayCount,
    customSchedulePercent:
      argv.customSchedulePercent || DEFAULT_CONFIG.customSchedulePercent
  }

  // Clear database if requested
  if (config.clear) {
    await clearDatabase()
  }

  // Handle user allowance adjustments if CSV file provided
  if (config.uaaFile) {
    await updateUserAllowanceAdjustments(config.uaaFile)
    if (!config.clear) return // Only return if not clearing, otherwise continue with seeding
  }

  // Check if company exists, if not create it
  const company = await getOrCreateCompany(config.companyId)

  // Create bank holidays
  await createBankHolidays(company, config.bankHolidayCount, config.dateRange)

  // Create company default schedule
  await createCompanySchedule(company)

  // Create departments first
  const departments = await createDepartments(company, config.departmentCount)

  // Create default user if flag is set
  if (config.createDefaultUser) {
    const defaultUser = await createDefaultBobUser(company, departments[0])
    console.log('Created default user:', defaultUser.email)
  }

  // Create users and related data
  const users = await createUsers(company, departments, config.associateCount)

  // Create custom schedules for some users
  await createUserSchedules(users, config.customSchedulePercent, company)

  // Update departments with managers
  await updateDepartmentsWithManagers(
    departments,
    users.filter(user => user.manager)
  )

  // Create leave types
  const leaveTypes = await createLeaveTypes(company)

  // Create leaves
  await createLeaves(
    users,
    leaveTypes,
    config.leavesMultiplier,
    config.dateRange
  )

  // Create messages for some users
  await createMessages(users, config.dateRange)

  console.log(
    `Seed data created successfully:
    - Company ID: ${company.id}
    - Departments: ${departments.length}
    - Users: ${users.length}
    - Leaves multiplier: ${config.leavesMultiplier}x
    - Date range: ${config.dateRange.from.toISOString().split('T')[0]} to ${config.dateRange.to.toISOString().split('T')[0]
    }
    - Bank holidays: ${config.bankHolidayCount}
    - Users with custom schedules: ${Math.round(config.customSchedulePercent)}%
    ${config.createDefaultUser ? '- Default user (bob@local.eml) created' : ''}`
  )
}

async function createBankHolidays(company, count, dateRange) {
  console.log('Creating bank holidays...')
  const holidays = []

  // Get all months in the date range
  const months = []
  const currentDate = new Date(dateRange.from)
  while (currentDate <= dateRange.to) {
    const month = currentDate.getMonth() + 1
    if (!months.includes(month)) {
      months.push(month)
    }
    currentDate.setMonth(currentDate.getMonth() + 1)
  }

  // Randomly select months for holidays
  const selectedMonths = faker.helpers
    .arrayElements(months, Math.min(count, months.length))
    .sort((a, b) => a - b) // Sort months chronologically

  for (const month of selectedMonths) {
    // Get a random day in the month that falls within our date range
    let date
    let attempts = 0
    const maxAttempts = 10

    do {
      const year = dateRange.from.getFullYear()
      const daysInMonth = new Date(year, month, 0).getDate()
      const day = faker.number.int({ min: 1, max: daysInMonth })
      date = new Date(year, month - 1, day)
      attempts++
    } while (
      (date < dateRange.from || date > dateRange.to) &&
      attempts < maxAttempts
    )

    if (attempts >= maxAttempts) continue

    // Get a random holiday name for this month
    const holidayName = faker.helpers.arrayElement(
      HOLIDAY_NAMES[month] || [`Holiday ${month}`]
    )

    try {
      const holiday = await prisma.bank_holidays.create({
        data: {
          name: holidayName,
          date: date,
          created_at: faker.date.past(),
          updated_at: faker.date.recent(),
          companies: {
            connect: { id: company.id }
          }
        }
      })
      holidays.push(holiday)
      console.log(
        `Created bank holiday: ${holiday.name} on ${holiday.date.toISOString().split('T')[0]
        }`
      )
    } catch (error) {
      console.error(`Failed to create holiday for ${month}:`, error.message)
    }
  }

  return holidays
}

async function createCompanySchedule(company) {
  // Create a default company schedule (Mon-Fri working, Sat-Sun off)
  const schedule = await prisma.schedules.create({
    data: {
      monday: 1,
      tuesday: 1,
      wednesday: 1,
      thursday: 1,
      friday: 1,
      saturday: 2,
      sunday: 2,
      created_at: faker.date.past(),
      updated_at: faker.date.recent(),
      company_id: company.id // Use company_id directly instead of connect
    }
  })
  console.log('Created company schedule')
  return schedule
}

async function createUserSchedules(users, percentWithCustom, company) {
  // Calculate how many users should get custom schedules
  const customCount = Math.round((users.length * percentWithCustom) / 100)

  // Randomly select users to get custom schedules
  const selectedUsers = faker.helpers.arrayElements(users, customCount)

  for (const user of selectedUsers) {
    // Create a random schedule
    // 1 = working day, 2 = non-working day
    const schedule = await prisma.schedules.create({
      data: {
        // Random working days, but ensure at least 3 working days per week
        monday: faker.helpers.arrayElement([1, 1, 2]),
        tuesday: faker.helpers.arrayElement([1, 1, 2]),
        wednesday: 1, // Always working
        thursday: faker.helpers.arrayElement([1, 1, 2]),
        friday: faker.helpers.arrayElement([1, 1, 2]),
        saturday: faker.helpers.arrayElement([1, 2, 2, 2]), // Mostly off
        sunday: faker.helpers.arrayElement([1, 2, 2, 2]), // Mostly off
        created_at: faker.date.past(),
        updated_at: faker.date.recent(),
        users: {
          connect: { id: user.id }
        },
        companies: {
          connect: { id: company.id } // Add company_id to ensure the connection
        }
      }
    })
    console.log(`Created custom schedule for user ${user.id}`)
  }
}

async function updateUserAllowanceAdjustments(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8')
    const lines = fileContent.split('\n')
    // Skip header row and empty lines
    const dataLines = lines.slice(1).filter(line => line.trim())

    let updated = 0
    let skipped = 0

    for (const line of dataLines) {
      const [year, adjustment, carried_over_allowance, user_id] = line.split(
        ','
      )

      try {
        // Check if user exists
        const user = await prisma.users.findUnique({
          where: { id: parseInt(user_id) }
        })

        if (!user) {
          console.log(`Skipping non-existent user ID: ${user_id}`)
          skipped++
          continue
        }

        // Upsert the allowance adjustment
        await prisma.user_allowance_adjustment.upsert({
          where: {
            user_id_year: {
              user_id: parseInt(user_id),
              year: parseInt(year)
            }
          },
          update: {
            adjustment: parseFloat(adjustment),
            carried_over_allowance: parseInt(carried_over_allowance)
          },
          create: {
            user_id: parseInt(user_id),
            year: parseInt(year),
            adjustment: parseFloat(adjustment),
            carried_over_allowance: parseInt(carried_over_allowance),
            created_at: new Date()
          }
        })
        updated++
      } catch (error) {
        console.error(`Error processing line: ${line}`, error)
        skipped++
      }
    }

    console.log(`Updated ${updated} allowance adjustments`)
    console.log(`Skipped ${skipped} records`)
  } catch (error) {
    console.error('Error reading or processing file:', error)
    throw error
  }
}

async function createDefaultBobUser(company, department) {
  // Check if bob@local.eml already exists
  const existingBob = await prisma.users.findFirst({
    where: { email: 'bob@local.eml' }
  })

  if (existingBob) {
    console.log('Default user bob@local.eml already exists')
    return existingBob
  }

  const defaultUser = await prisma.users.create({
    data: {
      email: 'bob@local.eml',
      password: hashifyPassword('bob'), // Hash the password
      name: 'Bob',
      lastname: 'Local',
      activated: true,
      admin: true,
      manager: false,
      auto_approve: true,
      start_date: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
      companies: {
        connect: { id: company.id }
      },
      departments: {
        connect: { id: department.id }
      }
    }
  })

  return defaultUser
}

async function getOrCreateCompany(companyId) {
  let company = await prisma.companies.findUnique({
    where: { id: companyId }
  })

  if (!company) {
    company = await prisma.companies.create({
      data: {
        id: companyId,
        name: faker.company.name(),
        country: faker.location.country(),
        start_of_new_year: faker.number.int({ min: 1, max: 12 }),
        created_at: faker.date.past(),
        updated_at: faker.date.recent()
      }
    })
    console.log(`Created new company with ID ${company.id}`)
  } else {
    console.log(`Using existing company with ID ${company.id}`)
  }

  return company
}

async function createDepartments(company, count) {
  const departments = []

  for (let i = 0; i < count; i++) {
    const departmentName = faker.commerce.department()

    // Check if the department already exists
    let existingDepartment = await prisma.departments.findFirst({
      where: {
        name: departmentName,
        companies: {
          id: company.id
        }
      }
    })

    // If the department doesn't exist, create it
    if (!existingDepartment) {
      const department = await prisma.departments.create({
        data: {
          name: departmentName,
          allowance: faker.number.float({ min: 20, max: 30, multipleOf: 0.5 }),
          include_public_holidays: faker.datatype.boolean(),
          is_accrued_allowance: faker.datatype.boolean(),
          created_at: faker.date.past(),
          updated_at: faker.date.recent(),
          personal: faker.number.float({ min: 0, max: 5, multipleOf: 0.5 }), // Random personal days
          companies: {
            connect: { id: company.id }
          }
        }
      })
      departments.push(department)
      console.log(`Created new department: ${department.name}`)
    } else {
      console.log(`Department already exists: ${existingDepartment.name}`)
      departments.push(existingDepartment) // Use the existing department
    }
  }

  return departments
}

async function createUsers(company, departments, count) {
  const users = []

  for (let i = 0; i < count; i++) {
    const isAdmin = i < 2 // Make the first two users admins
    const isManager = i < 5 // Make the first five users managers
    const password = generateSecurePassword()

    const user = await prisma.users.create({
      data: {
        email: `${faker.internet.userName()}@example.com`,
        password: hashifyPassword(password), // Hash the password
        name: faker.person.firstName(),
        lastname: faker.person.lastName(),
        activated: true,
        admin: isAdmin,
        manager: isManager,
        auto_approve: faker.datatype.boolean(),
        start_date: faker.date.past(),
        created_at: faker.date.past(),
        updated_at: faker.date.recent(),
        companies: {
          connect: { id: company.id }
        },
        departments: {
          connect: { id: faker.helpers.arrayElement(departments).id }
        }
      }
    })
    console.log(`Created user ${i + 1} of ${count}`)
    console.log(`e: ${user.email} p: ${password}`)
    users.push(user)
  }

  return users
}

async function updateDepartmentsWithManagers(departments, managers) {
  for (const department of departments) {
    await prisma.departments.update({
      where: { id: department.id },
      data: {
        manager_id: faker.helpers.arrayElement(managers).id
      }
    })
  }
}

async function createLeaveTypes(company) {
  // Generate dynamic leave type names using faker
  const generateLeaveName = () => {
    const prefixes = [
      'Annual',
      'Special',
      'Personal',
      'Emergency',
      'Wellness',
      'Family',
      'Professional',
      'Remote',
      'Flexible',
      'Extended'
    ]
    const activities = [
      'Leave',
      'Break',
      'Time Off',
      'Rest',
      'Holiday',
      'Retreat',
      'Absence',
      'Pause',
      'Recovery',
      'Recharge'
    ]
    const suffixes = ['Day', 'Period', 'Session', 'Duration', 'Time']

    return `${faker.helpers.arrayElement(
      prefixes
    )} ${faker.helpers.arrayElement(activities)} ${faker.helpers.arrayElement(
      suffixes
    )}`
  }

  const colors = [
    '#3498db',
    '#e74c3c',
    '#2ecc71',
    '#f39c12',
    '#9b59b6',
    '#e67e22',
    '#1abc9c',
    '#e84393',
    '#34495e',
    '#16a085'
  ]
  const leaveTypes = Array.from({ length: 10 }, (_, index) => ({
    name: generateLeaveName(),
    color: faker.helpers.arrayElement(colors),
    use_allowance: faker.datatype.boolean(),
    is_special: faker.datatype.boolean({ probability: 0.3 }), // 30% chance of being special
    auto_approve: faker.datatype.boolean({ probability: 0.2 }), // 20% chance of auto-approve
    manager_only: faker.datatype.boolean({ probability: 0.15 }) // 15% chance of manager only
  }))

  const createdLeaveTypes = []

  for (let i = 0; i < leaveTypes.length; i++) {
    const leaveType = leaveTypes[i]
    const createdLeaveType = await prisma.leave_types.create({
      data: {
        ...leaveType,
        created_at: faker.date.past(),
        updated_at: faker.date.recent(),
        sort_order: i, // Add sort order based on index
        limit: faker.number.int({ min: 0, max: 30 }), // Random limit between 0-30 days
        companies: {
          connect: { id: company.id }
        }
      }
    })
    createdLeaveTypes.push(createdLeaveType)
  }

  return createdLeaveTypes
}

async function createMessages(users, dateRange) {
  // Create messages for 30% of users
  const usersWithMessages = faker.helpers.arrayElements(
    users,
    Math.ceil(users.length * 0.3)
  )

  console.log('Creating messages...')

  for (const user of usersWithMessages) {
    // Create 1-5 messages per user
    const messageCount = faker.number.int({ min: 1, max: 5 })

    for (let i = 0; i < messageCount; i++) {
      const created_at = faker.date.between({
        from: dateRange.from,
        to: dateRange.to
      })

      const subjects = [
        'Technical Issue Report',
        'Feature Request',
        'System Bug Found',
        'Question about Time Off',
        'Feedback on Interface',
        'Calendar Sync Issue',
        'Account Access Problem',
        'Mobile App Suggestion',
        'Department Settings Question',
        'Leave Balance Inquiry'
      ]

      const messageTemplates = [
        'I encountered an issue with {feature}. When I try to {action}, the system {problem}.',
        'Would it be possible to add {feature}? This would help with {benefit}.',
        'The {feature} seems to be showing incorrect data when {action}.',
        'I need clarification on how to {action} in the system.',
        'I have a suggestion to improve {feature} by {improvement}.'
      ]

      const features = [
        'calendar view',
        'leave request form',
        'notification system',
        'department settings',
        'user profile',
        'reporting dashboard',
        'time tracking',
        'approval workflow',
        'holiday schedule',
        'absence history'
      ]

      const actions = [
        'submit a request',
        'view my schedule',
        'update settings',
        'generate reports',
        'sync calendar',
        'approve leaves',
        'check balances',
        'add team members',
        'set preferences',
        'export data'
      ]

      const problems = [
        'shows an error message',
        'freezes unexpectedly',
        'loses the entered data',
        'displays incorrect information',
        'takes too long to respond'
      ]

      const improvements = [
        'adding more filtering options',
        'simplifying the workflow',
        'providing better notifications',
        'including more details',
        'making it more user-friendly'
      ]

      const benefits = [
        'improve team coordination',
        'save time on administrative tasks',
        'reduce confusion',
        'make planning easier',
        'increase productivity'
      ]

      // Generate message content
      const messageTemplate = faker.helpers.arrayElement(messageTemplates)
      const message = messageTemplate
        .replace('{feature}', faker.helpers.arrayElement(features))
        .replace('{action}', faker.helpers.arrayElement(actions))
        .replace('{problem}', faker.helpers.arrayElement(problems))
        .replace('{improvement}', faker.helpers.arrayElement(improvements))
        .replace('{benefit}', faker.helpers.arrayElement(benefits))

      await prisma.user_messages.create({
        data: {
          name: `${user.name} ${user.lastname}`,
          email: `${user.name.toLowerCase()}.${user.lastname.toLowerCase()}@example.com`,
          subject: faker.helpers.arrayElement(subjects),
          message: message,
          status: faker.helpers.arrayElement([
            'new',
            'in-progress',
            'resolved'
          ]),
          created_at,
          updated_at: faker.date.between({
            from: created_at,
            to: dateRange.to
          }),
          user_id: user.id,
          company_id: user.company_id
        }
      })
    }
    console.log(`Created messages for user ${user.id}`)
  }
}

async function createLeaves(users, leaveTypes, multiplier, dateRange) {
  for (const user of users) {
    const leaveCount = faker.number.int({ min: 1, max: 5 }) * multiplier

    for (let i = 0; i < leaveCount; i++) {
      const startDate = faker.date.between({
        from: dateRange.from,
        to: dateRange.to
      })
      const endDate = new Date(startDate)
      endDate.setDate(endDate.getDate() + faker.number.int({ min: 1, max: 7 }))

      // Ensure end date doesn't exceed the date range
      if (endDate > dateRange.to) {
        endDate.setTime(dateRange.to.getTime())
      }

      await prisma.leaves.create({
        data: {
          user_id: user.id,
          leave_type_id: faker.helpers.arrayElement(leaveTypes).id,
          status: faker.helpers.arrayElement([1, 2, 3]), // 1: Pending, 2: Approved, 3: Rejected
          employee_comment: faker.lorem.sentence(),
          approver_comment: faker.lorem.sentence(),
          decided_at: faker.date.recent(),
          date_start: startDate,
          date_end: endDate,
          day_part_start: faker.helpers.arrayElement([1, 2, 3]), // 1: All day, 2: Morning, 3: Afternoon
          day_part_end: faker.helpers.arrayElement([1, 2, 3]),
          created_at: faker.date.past(),
          updated_at: faker.date.recent()
        }
      })
      console.log(`Created leave ${i + 1} of ${leaveCount}`)
    }
  }
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
