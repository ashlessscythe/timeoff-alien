import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { User } = require('../../lib/model/sessionUser.js')

/** Default primary department JSON for `allowed_increments` after reset. */
export const DEFAULT_DEPARTMENT_INCREMENTS = '["full_day","half_day"]'

/**
 * Best-effort cleanup of volatile rows for a given company.
 *
 * Intentionally avoids deleting base fixtures like companies/users/departments/leave_types.
 * This is meant for speeding up integration tests that reuse a seeded company.
 */
export async function cleanupCompanyVolatileData(prisma, companyId) {
  if (!companyId) return

  const users = await prisma.users.findMany({
    where: { company_id: companyId },
    select: { id: true }
  })
  const userIds = users.map(u => u.id)
  if (userIds.length === 0) return

  await prisma.leaves.deleteMany({
    where: { user_id: { in: userIds } }
  })

  if (prisma.user_allowance_adjustment?.deleteMany) {
    await prisma.user_allowance_adjustment.deleteMany({
      where: { user_id: { in: userIds } }
    })
  }
}

/**
 * Reset a registered company to a single admin + primary department baseline.
 * Deletes extra users/departments, clears supervisors, restores default dept fields.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ companyId: number, adminUserId: number, primaryDepartmentId: number, departmentDefaults?: Partial<{ name: string, allowance: number, personal: number, include_public_holidays: boolean, is_accrued_allowance: boolean, allowed_increments: string }> }} opts
 */
export async function resetCompanyToAdminBaseline(prisma, opts) {
  const { companyId, adminUserId, primaryDepartmentId } = opts
  if (!companyId || !adminUserId || !primaryDepartmentId) return

  const d = opts.departmentDefaults || {}
  const name = d.name ?? 'Sales'
  const allowance = d.allowance ?? 20
  const personal = d.personal ?? 5
  const include_public_holidays = d.include_public_holidays ?? true
  const is_accrued_allowance = d.is_accrued_allowance ?? false
  const allowed_increments = d.allowed_increments ?? DEFAULT_DEPARTMENT_INCREMENTS

  const companyUserIds = (
    await prisma.users.findMany({
      where: { company_id: companyId },
      select: { id: true }
    })
  ).map(u => u.id)

  const disposableUserIds = companyUserIds.filter(id => id !== adminUserId)

  if (companyUserIds.length > 0) {
    await prisma.comments.deleteMany({
      where: { company_id: companyId, entity_type: 'LEAVE' }
    })
    await prisma.leaves.deleteMany({
      where: {
        OR: [
          { user_id: { in: companyUserIds } },
          { approver_id: { in: disposableUserIds } }
        ]
      }
    })
    if (prisma.user_allowance_adjustment?.deleteMany) {
      await prisma.user_allowance_adjustment.deleteMany({
        where: { user_id: { in: companyUserIds } }
      })
    }
    await prisma.schedules.deleteMany({
      where: {
        OR: [{ company_id: companyId }, { user_id: { in: companyUserIds } }]
      }
    })
  }

  if (disposableUserIds.length > 0) {
    await prisma.email_audits.deleteMany({
      where: { user_id: { in: disposableUserIds } }
    })
    await prisma.comments.deleteMany({
      where: { by_user_id: { in: disposableUserIds } }
    })
    await prisma.audit.deleteMany({
      where: { by_user_id: { in: disposableUserIds } }
    })
    if (prisma.user_feeds?.deleteMany) {
      await prisma.user_feeds.deleteMany({
        where: { user_id: { in: disposableUserIds } }
      })
    }
  }

  const companyDeptIds = (
    await prisma.departments.findMany({
      where: { company_id: companyId },
      select: { id: true }
    })
  ).map(d => d.id)

  if (companyDeptIds.length > 0) {
    await prisma.department_supervisors.deleteMany({
      where: { department_id: { in: companyDeptIds } }
    })
    await prisma.department_leave_types.deleteMany({
      where: { department_id: { in: companyDeptIds } }
    })
  }

  await prisma.departments.update({
    where: { id: primaryDepartmentId },
    data: {
      manager_id: adminUserId
    }
  })

  await prisma.users.deleteMany({
    where: { company_id: companyId, id: { not: adminUserId } }
  })

  await prisma.departments.deleteMany({
    where: { company_id: companyId, id: { not: primaryDepartmentId } }
  })

  await prisma.departments.update({
    where: { id: primaryDepartmentId },
    data: {
      name,
      allowance,
      personal,
      include_public_holidays,
      is_accrued_allowance,
      manager_id: adminUserId,
      allowed_increments
    }
  })

  await prisma.users.update({
    where: { id: adminUserId },
    data: {
      department_id: primaryDepartmentId,
      admin: true,
      manager: false
    }
  })
}

/**
 * Restore profile/email columns and clear email audit rows for a fixture user.
 */
export async function resetUserProfileEmailState(prisma, { userId, baselineEmail }) {
  if (!userId || !baselineEmail) return

  await prisma.email_audits.deleteMany({
    where: { user_id: userId }
  })

  await prisma.users.update({
    where: { id: userId },
    data: {
      email: baselineEmail,
      pending_email: null,
      email_change_token: null,
      email_change_expires: null
    }
  })
}

/**
 * Restore password + clear reset token so the user can log in with `plainPassword` again.
 */
export async function restoreFixtureAdminPassword(prisma, { userId, plainPassword }) {
  if (!userId || !plainPassword) return

  await prisma.users.update({
    where: { id: userId },
    data: {
      password: User.hashify_password(plainPassword),
      reset_password_token: null,
      reset_password_expires: null
    }
  })
}

/**
 * Delete a company and all rows that block FK removal (`bank_holidays`, `comments`,
 * `leaves`, etc.). Use for scratch companies created inside a single integration test.
 */
export async function deleteCompanyAndChildren(prisma, companyId) {
  if (!companyId) return

  const users = await prisma.users.findMany({
    where: { company_id: companyId },
    select: { id: true }
  })
  const userIds = users.map(u => u.id)

  if (userIds.length > 0) {
    await prisma.leaves.deleteMany({
      where: {
        OR: [{ user_id: { in: userIds } }, { approver_id: { in: userIds } }]
      }
    })
    if (prisma.user_allowance_adjustment?.deleteMany) {
      await prisma.user_allowance_adjustment.deleteMany({
        where: { user_id: { in: userIds } }
      })
    }
    if (prisma.user_feeds?.deleteMany) {
      await prisma.user_feeds.deleteMany({
        where: { user_id: { in: userIds } }
      })
    }
  }

  await prisma.email_audits.deleteMany({
    where:
      userIds.length > 0
        ? { OR: [{ company_id: companyId }, { user_id: { in: userIds } }] }
        : { company_id: companyId }
  })

  await prisma.comments.deleteMany({ where: { company_id: companyId } })
  await prisma.bank_holidays.deleteMany({ where: { company_id: companyId } })

  await prisma.audit.deleteMany({
    where:
      userIds.length > 0
        ? { OR: [{ company_id: companyId }, { by_user_id: { in: userIds } }] }
        : { company_id: companyId }
  })

  await prisma.schedules.deleteMany({
    where:
      userIds.length > 0
        ? { OR: [{ company_id: companyId }, { user_id: { in: userIds } }] }
        : { company_id: companyId }
  })

  await prisma.user_messages.deleteMany({ where: { company_id: companyId } })

  const deptIds = (
    await prisma.departments.findMany({
      where: { company_id: companyId },
      select: { id: true }
    })
  ).map(d => d.id)
  if (deptIds.length > 0) {
    await prisma.department_supervisors.deleteMany({
      where: { department_id: { in: deptIds } }
    })
    await prisma.department_leave_types.deleteMany({
      where: { department_id: { in: deptIds } }
    })
  }

  await prisma.companies.delete({ where: { id: companyId } })
}
