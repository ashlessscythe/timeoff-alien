import { faker } from '@faker-js/faker'
import { PrismaClient } from '@prisma/client'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

const prisma = new PrismaClient()

const argv = yargs(hideBin(process.argv))
  .option('clear', {
    type: 'boolean',
    description: 'Clear all data from db'
  })
  .option('use-faker', {
    type: 'number',
    description: 'Number of associates to create'
  })
  .option('leaves-multiplier', {
    type: 'number',
    default: 3,
    description: 'Multiplier for the number of leaves per associate'
  })
  .option('department-count', {
    type: 'number',
    default: 5,
    description: 'Count of departments to create by default'
  })
  .option('company-id', {
    type: 'number',
    default: 1,
    description: 'Company ID to use for seeding data'
  }).argv

async function main() {
  const clearFlag = argv.clear || false
  const companyId = argv.companyId
  const associateCount = argv.useFaker || 0
  const leavesMultiplier = argv.leavesMultiplier
  const departmentCount = argv.departmentCount

  if (clearFlag) {
    // Delete dependent tables first (child tables)
    await prisma.department_supervisors.deleteMany() // Depends on departments and users
    await prisma.leaves.deleteMany() // Depends on users and leave_types
    await prisma.user_allowance_adjustment.deleteMany() // Depends on users
    await prisma.user_feeds.deleteMany() // Depends on users
    await prisma.email_audits.deleteMany() // Depends on users and companies
    await prisma.comments.deleteMany() // Depends on users and companies
    await prisma.audit.deleteMany() // Depends on users and companies

    // Delete from middle-level tables
    await prisma.schedules.deleteMany() // Depends on users and companies
    await prisma.departments.deleteMany() // Depends on companies
    await prisma.leave_types.deleteMany() // Depends on companies
    await prisma.bank_holidays.deleteMany() // Depends on companies
    await prisma.users.deleteMany() // Depends on departments and companies

    // Delete from parent tables
    await prisma.companies.deleteMany()

    // Delete unrelated tables last (no FKs)
    await prisma.sequelizeMeta.deleteMany()
    await prisma.sessions.deleteMany()
    return
  }

  if (associateCount === 0) {
    console.log(
      'No associates specified. Use --use-faker <number> to generate fake data.'
    )
    return
  }

  // Check if company exists, if not create it
  const company = await getOrCreateCompany(companyId)

  // Create departments first
  const departments = await createDepartments(company, departmentCount)

  // Create users and assign to departments
  const users = await createUsers(company, departments, associateCount)

  // Update departments with managers
  await updateDepartmentsWithManagers(
    departments,
    users.filter(user => user.manager)
  )

  // Create leave types
  const leaveTypes = await createLeaveTypes(company)

  // Create leaves
  await createLeaves(users, leaveTypes, leavesMultiplier)

  console.log(
    `Seed data created successfully for ${associateCount} associates with ${leavesMultiplier}x leaves in company ${
      company.id
    }`
  )
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

    const user = await prisma.users.create({
      data: {
        email: faker.internet.email(),
        password: faker.internet.password(),
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
    console.log(`Created user ${i} of ${count}`)
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
  const leaveTypes = [
    { name: 'Beach Bum Day', color: '#3498db', use_allowance: true },
    { name: 'Netflix & Sick', color: '#e74c3c', use_allowance: false },
    { name: 'Me, Myself, and I Day', color: '#2ecc71', use_allowance: true },
    { name: 'Couch Commander', color: '#f39c12', use_allowance: false },
    { name: 'Procrastination Paradise', color: '#9b59b6', use_allowance: true },
    { name: 'Brain Fart Recovery', color: '#e67e22', use_allowance: false },
    { name: 'Pretend to Be Productive', color: '#1abc9c', use_allowance: true },
    { name: 'Secret Mission Leave', color: '#e74c3c', use_allowance: false },
    { name: 'Spa Day for the Soul', color: '#e84393', use_allowance: true },
    { name: 'Avoid People Pass', color: '#34495e', use_allowance: false }
  ]

  const createdLeaveTypes = []

  for (const leaveType of leaveTypes) {
    const createdLeaveType = await prisma.leave_types.create({
      data: {
        ...leaveType,
        created_at: faker.date.past(),
        updated_at: faker.date.recent(),
        companies: {
          connect: { id: company.id }
        }
      }
    })
    createdLeaveTypes.push(createdLeaveType)
  }

  return createdLeaveTypes
}

async function createLeaves(users, leaveTypes, multiplier) {
  for (const user of users) {
    const leaveCount = faker.number.int({ min: 1, max: 5 }) * multiplier

    for (let i = 0; i < leaveCount; i++) {
      const startDate = faker.date.between({
        from: '2023-01-01',
        to: '2024-12-31'
      })
      const endDate = new Date(startDate)
      endDate.setDate(endDate.getDate() + faker.number.int({ min: 1, max: 7 }))

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
      console.log(`Created leave ${i} of ${leaveCount}`)
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
