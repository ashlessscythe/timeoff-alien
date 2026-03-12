'use strict'

const prisma = require('../prisma/client')

const getAuditPrisma = async ({ companyId }) => {
  const rows = await prisma.audit.findMany({
    where: {
      company_id: companyId
    },
    orderBy: {
      at: 'desc'
    }
  })

  return rows
}

module.exports = {
  getAuditPrisma
}

