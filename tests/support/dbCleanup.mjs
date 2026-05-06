/**
 * Best-effort cleanup of volatile rows for a given company.
 *
 * Intentionally avoids deleting base fixtures like companies/users/departments/leave_types.
 * This is meant for speeding up integration tests that reuse a seeded company.
 */
export async function cleanupCompanyVolatileData(prisma, companyId) {
  if (!companyId) return

  // Avoid relation filters (can devolve into expensive joins). We only need to
  // delete by user_id for users in this company.
  const users = await prisma.users.findMany({
    where: { company_id: companyId },
    select: { id: true }
  })
  const userIds = users.map(u => u.id)
  if (userIds.length === 0) return

  // Leaves are by far the noisiest rows across integration tests.
  await prisma.leaves.deleteMany({
    where: { user_id: { in: userIds } }
  })

  // Some tests upsert allowance adjustments; keep things deterministic.
  if (prisma.user_allowance_adjustment?.deleteMany) {
    await prisma.user_allowance_adjustment.deleteMany({
      where: { user_id: { in: userIds } }
    })
  }
}

