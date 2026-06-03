import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import app from '../support/loadEnvAndApp.mjs'
import { createAgent, registerCompanyAndAdmin, addEmployee } from '../support/http.mjs'
import {
  resetCompanyToAdminBaseline
} from '../support/dbCleanup.mjs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const prisma = require('../../lib/prisma/client.js')
const leaveConstants = require('../../lib/model/leave_constants.js')

function day(iso) {
  return new Date(`${iso}T00:00:00.000Z`)
}

function uniqueSuffix() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

async function allLeaveTypeIdStrings(companyId) {
  const rows = await prisma.leave_types.findMany({
    where: { company_id: companyId },
    select: { id: true }
  })
  return rows.map(r => String(r.id))
}

/** Parse /users/?as-csv=1 row for a given user email (lowercase match). */
function rowForEmailFromUsersCsv(text, emailLower) {
  const lines = text.trim().split('\n')
  const header = lines[0].split(',').map(s => s.replace(/^"|"$/g, ''))
  const idx = Object.fromEntries(header.map((k, i) => [k, i]))
  const row = lines.slice(1).find(line => {
    const cols = line.split(',').map(s => s.replace(/^"|"$/g, ''))
    return (cols[idx.email] || '').toLowerCase() === emailLower
  })
  if (!row) return { idx, cols: null }
  const cols = row.split(',').map(s => s.replace(/^"|"$/g, ''))
  return { idx, cols }
}

describe('departments', () => {
  /** @type {import('supertest').TestAgent} */
  let agent
  let adminId
  let primaryDeptId
  let companyId

  beforeAll(async () => {
    agent = createAgent(app)
    const { email } = await registerCompanyAndAdmin(agent)
    const admin = await prisma.users.findFirst({ where: { email } })
    expect(admin).toBeTruthy()
    adminId = admin.id
    primaryDeptId = admin.department_id
    companyId = admin.company_id
  }, 120000)

  afterEach(async () => {
    await resetCompanyToAdminBaseline(prisma, {
      companyId,
      adminUserId: adminId,
      primaryDepartmentId: primaryDeptId
    })
  })

  async function admin() {
    return prisma.users.findUnique({ where: { id: adminId } })
  }

  it('creates a department via POST /settings/departments/', async () => {
    const a = await admin()
    const deptName = `Engineering ${Date.now()}`
    const res = await agent
      .post('/settings/departments/')
      .type('form')
      .send({
        name__new: deptName,
        allowance__new: '15',
        personal__new: '3',
        manager_id__new: String(a.id),
        include_public_holidays__new: 'on',
        is_accrued_allowance__new: 'off',
        'allowed_increments[]': ['full_day', 'half_day']
      })
      .redirects(5)

    expect(res.status).toBeLessThan(400)

    const created = await prisma.departments.findFirst({
      where: { company_id: a.company_id, name: deptName }
    })
    expect(created).toBeTruthy()
    expect(created.allowance).toBe(15)
    expect(created.personal).toBe(3)
  })

  it('updates department via POST edit: rename, manager, allowance, personal, flags, increments', async () => {
    const a = await admin()
    const sfx = uniqueSuffix()
    const mgrEmail = `dept_mgr_${sfx}@example.com`
    await addEmployee(agent, {
      email: mgrEmail,
      departmentId: a.department_id,
      manager: true,
      name: 'M',
      lastname: 'Manager'
    })
    const mgr = await prisma.users.findFirst({ where: { email: mgrEmail } })
    const deptId = a.department_id
    const newName = `RenamedDept_${sfx}`

    const res = await agent
      .post(`/settings/departments/edit/${deptId}/`)
      .type('form')
      .send({
        name: newName,
        manager_id: String(mgr.id),
        allowance: '18.5',
        personal: '4',
        include_public_holidays: 'on',
        is_accrued_allowance: 'on',
        'allowed_increments[]': ['full_day', 'half_day', 'hourly'],
        'allowed_leave_type_ids[]': await allLeaveTypeIdStrings(a.company_id)
      })
      .redirects(5)

    expect(res.status).toBeLessThan(400)

    const updated = await prisma.departments.findUnique({ where: { id: deptId } })
    expect(updated.name).toBe(newName)
    expect(updated.manager_id).toBe(mgr.id)
    expect(updated.allowance).toBe(18.5)
    expect(updated.personal).toBe(4)
    expect(updated.include_public_holidays).toBe(true)
    expect(updated.is_accrued_allowance).toBe(true)
    expect(JSON.parse(updated.allowed_increments)).toEqual(
      expect.arrayContaining(['full_day', 'half_day', 'hourly'])
    )
  })

  it('toggles accrued and public-holiday checkboxes off when omitted from edit POST', async () => {
    const a = await admin()
    const deptId = a.department_id

    await prisma.departments.update({
      where: { id: deptId },
      data: {
        include_public_holidays: true,
        is_accrued_allowance: true
      }
    })

    const res = await agent
      .post(`/settings/departments/edit/${deptId}/`)
      .type('form')
      .send({
        name: 'Sales',
        manager_id: String(a.id),
        allowance: '20',
        personal: '5',
        'allowed_increments[]': ['full_day', 'half_day'],
        'allowed_leave_type_ids[]': await allLeaveTypeIdStrings(a.company_id)
      })
      .redirects(5)

    expect(res.status).toBeLessThan(400)

    const updated = await prisma.departments.findUnique({ where: { id: deptId } })
    expect(updated.include_public_holidays).toBe(false)
    expect(updated.is_accrued_allowance).toBe(false)
  })

  it('adds a secondary supervisor via POST with do_add_supervisors', async () => {
    const a = await admin()
    const sfx = uniqueSuffix()
    const mgrEmail = `dept_head_${sfx}@example.com`
    const empEmail = `dept_emp_${sfx}@example.com`
    await addEmployee(agent, {
      email: mgrEmail,
      departmentId: a.department_id,
      manager: true,
      name: 'Head',
      lastname: 'Manager'
    })
    await addEmployee(agent, {
      email: empEmail,
      departmentId: a.department_id,
      name: 'E',
      lastname: 'Employee'
    })
    const mgr = await prisma.users.findFirst({ where: { email: mgrEmail } })
    const emp = await prisma.users.findFirst({ where: { email: empEmail } })
    const deptId = a.department_id

    await agent
      .post(`/settings/departments/edit/${deptId}/`)
      .type('form')
      .send({
        name: 'Sales',
        manager_id: String(mgr.id),
        allowance: '20',
        personal: '5',
        'allowed_increments[]': ['full_day', 'half_day'],
        'allowed_leave_type_ids[]': await allLeaveTypeIdStrings(a.company_id)
      })
      .redirects(5)

    const addSup = await agent
      .post(`/settings/departments/edit/${deptId}/`)
      .type('form')
      .send({
        do_add_supervisors: '1',
        supervisor_id: [String(a.id), String(emp.id)]
      })
      .redirects(5)

    expect(addSup.status).toBeLessThan(400)

    const links = await prisma.department_supervisors.findMany({
      where: { department_id: deptId }
    })
    const userIds = links.map(l => l.user_id).sort((x, y) => x - y)
    expect(userIds).toEqual([a.id, emp.id].sort((x, y) => x - y))
  })

  it('employee CSV allowance reflects department allowance after edit (leave rows unchanged)', async () => {
    const a = await admin()
    const sfx = uniqueSuffix()
    const empEmail = `dept_csv_${sfx}@example.com`
    await addEmployee(agent, {
      email: empEmail,
      departmentId: a.department_id,
      name: 'C',
      lastname: 'CsvUser'
    })
    const emp = await prisma.users.findFirst({ where: { email: empEmail } })
    const holiday = await prisma.leave_types.findFirst({
      where: { company_id: emp.company_id, name: 'Holiday' }
    })
    expect(holiday).toBeTruthy()

    const deptId = emp.department_id
    await prisma.departments.update({
      where: { id: deptId },
      data: { allowance: 25, personal: 0, manager_id: a.id }
    })

    const ts = new Date()
    await prisma.leaves.create({
      data: {
        user_id: emp.id,
        leave_type_id: holiday.id,
        approver_id: a.id,
        status: leaveConstants.status_approved(),
        employee_comment: 'dept-test',
        date_start: day('2026-06-01'),
        date_end: day('2026-06-01'),
        day_part_start: 1,
        day_part_end: 1,
        time_start: null,
        time_end: null,
        created_at: ts,
        updated_at: ts
      }
    })

    const csvBefore = await agent.get('/users/?as-csv=1').redirects(0)
    expect(csvBefore.status).toBe(200)
    let { idx, cols } = rowForEmailFromUsersCsv(csvBefore.text, empEmail.toLowerCase())
    expect(cols).toBeTruthy()
    expect(Number(cols[idx.days_used])).toBe(1)
    expect(Number(cols[idx.remaining_allowance])).toBe(24)

    const leaveBefore = await prisma.leaves.findFirst({
      where: { user_id: emp.id, employee_comment: 'dept-test' }
    })
    expect(leaveBefore).toBeTruthy()

    const edit = await agent
      .post(`/settings/departments/edit/${deptId}/`)
      .type('form')
      .send({
        name: 'Sales',
        manager_id: String(a.id),
        allowance: '14',
        personal: '0',
        'allowed_increments[]': ['full_day', 'half_day'],
        'allowed_leave_type_ids[]': await allLeaveTypeIdStrings(emp.company_id)
      })
      .redirects(5)

    expect(edit.status).toBeLessThan(400)

    const leaveAfter = await prisma.leaves.findUnique({ where: { id: leaveBefore.id } })
    expect(leaveAfter.status).toBe(leaveConstants.status_approved())
    expect(leaveAfter.date_start.getTime()).toBe(leaveBefore.date_start.getTime())

    const deptRow = await prisma.departments.findUnique({ where: { id: deptId } })
    expect(deptRow.allowance).toBe(14)

    const csvAfter = await agent.get('/users/?as-csv=1').redirects(0)
    expect(csvAfter.status).toBe(200)
    ;({ idx, cols } = rowForEmailFromUsersCsv(csvAfter.text, empEmail.toLowerCase()))
    expect(cols).toBeTruthy()
    expect(Number(cols[idx.days_used])).toBe(1)
    expect(Number(cols[idx.remaining_allowance])).toBe(13)
  })

  it('persists available leave types for a department', async () => {
    const a = await admin()
    const deptId = a.department_id
    const leaveTypes = await prisma.leave_types.findMany({
      where: { company_id: a.company_id }
    })
    expect(leaveTypes.length).toBeGreaterThanOrEqual(2)

    const holiday = leaveTypes.find(lt => lt.name === 'Holiday')
    expect(holiday).toBeTruthy()

    const save = await agent
      .post(`/settings/departments/edit/${deptId}/`)
      .type('form')
      .send({
        name: 'Sales',
        manager_id: String(a.id),
        allowance: '20',
        personal: '5',
        'allowed_increments[]': ['full_day', 'half_day'],
        'allowed_leave_type_ids[]': [String(holiday.id)]
      })
      .redirects(5)
    expect(save.status).toBeLessThan(400)

    const links = await prisma.department_leave_types.findMany({
      where: { department_id: deptId }
    })
    expect(links.map(l => l.leave_type_id)).toEqual([holiday.id])

    const page = await agent
      .get(`/settings/departments/edit/${deptId}/`)
      .redirects(5)
    expect(page.status).toBe(200)
    expect(page.text).toContain('Available leave types')
    expect(page.text).toContain('name="allowed_leave_type_ids[]"')
    expect(page.text).toContain(`value="${holiday.id}"`)
  })

  it('refuses to delete a department that still has users', async () => {
    const a = await admin()
    const deptId = a.department_id

    const del = await agent
      .post(`/settings/departments/delete/${deptId}/`)
      .type('form')
      .send({})
      .redirects(5)

    expect(del.status).toBeLessThan(400)
    const stillThere = await prisma.departments.findUnique({ where: { id: deptId } })
    expect(stillThere).toBeTruthy()
  })
})
