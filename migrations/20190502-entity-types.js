'use strict'

const models = require('../lib/model/db')

module.exports = {
  up: async function(queryInterface, Sequelize) {
    await queryInterface.describeTable('comments').then(async attributes => {
      if (attributes.entityType) {
        await queryInterface.renameColumn(
          'comment',
          'entityType',
          'entity_type'
        )
      }

      if (attributes.entityId) {
        await queryInterface.renameColumn('comment', 'entityId', 'entity_id')
      }

      if (attributes.companyId) {
        await queryInterface.renameColumn('comment', 'companyId', 'company_id')
      }
    })

    await queryInterface.describeTable('audit').then(async attributes => {
      if (attributes.entityType) {
        await queryInterface.renameColumn('audit', 'entityType', 'entity_type')
      }

      if (attributes.entityId) {
        await queryInterface.renameColumn('audit', 'entityId', 'entity_id')
      }

      if (attributes.oldValue) {
        await queryInterface.renameColumn('audit', 'oldValue', 'old_value')
      }

      if (attributes.newValue) {
        await queryInterface.renameColumn('audit', 'newValue', 'new_value')
      }
    })

    await queryInterface.describeTable('companies').then(async attributes => {
      if (attributes.companyId) {
        await queryInterface.renameColumn(
          'companies',
          'companyId',
          'company_id'
        )
      }

      if (attributes.DepartmentId) {
        await queryInterface.renameColumn(
          'companies',
          'DepartmentId',
          'department_id'
        )
      }
    })

    await queryInterface.describeTable('departments').then(async attributes => {
      if (attributes.companyId) {
        await queryInterface.renameColumn(
          'departments',
          'companyId',
          'company_id'
        )
      }

      if (attributes.DepartmentId) {
        await queryInterface.renameColumn(
          'department',
          'DepartmentId',
          'department_id'
        )
      }

      if (attributes.bossId) {
        await queryInterface.renameColumn('departments', 'bossId', 'manager_id')
      }
    })

    await queryInterface
      .describeTable('bank_holidays')
      .then(async attributes => {
        if (attributes.companyId) {
          await queryInterface.renameColumn(
            'bank_holidays',
            'companyId',
            'company_id'
          )
        }

        if (attributes.DepartmentId) {
          await queryInterface.renameColumn(
            'bank_holidays',
            'DepartmentId',
            'department_id'
          )
        }
      })

    await queryInterface
      .describeTable('department_supervisors')
      .then(async attributes => {
        if (attributes.companyId) {
          await queryInterface.renameColumn(
            'department_supervisors',
            'companyId',
            'company_id'
          )
        }

        if (attributes.DepartmentId) {
          await queryInterface.renameColumn(
            'department_supervisors',
            'DepartmentId',
            'department_id'
          )
        }
      })

    await queryInterface
      .describeTable('email_audits')
      .then(async attributes => {
        if (attributes.companyId) {
          await queryInterface.renameColumn(
            'email_audits',
            'companyId',
            'company_id'
          )
        }

        if (attributes.DepartmentId) {
          await queryInterface.renameColumn(
            'email_audits',
            'DepartmentId',
            'department_id'
          )
        }
      })

    await queryInterface.describeTable('leaves').then(async attributes => {
      if (attributes.companyId) {
        await queryInterface.renameColumn('leaves', 'companyId', 'company_id')
      }

      if (attributes.DepartmentId) {
        await queryInterface.renameColumn(
          'leaves',
          'DepartmentId',
          'department_id'
        )
      }
    })

    await queryInterface.describeTable('leave_types').then(async attributes => {
      if (attributes.companyId) {
        await queryInterface.renameColumn(
          'leave_types',
          'companyId',
          'company_id'
        )
      }

      if (attributes.DepartmentId) {
        await queryInterface.renameColumn(
          'leave_types',
          'DepartmentId',
          'department_id'
        )
      }
    })

    await queryInterface.describeTable('schedules').then(async attributes => {
      if (attributes.companyId) {
        await queryInterface.renameColumn(
          'schedules',
          'companyId',
          'company_id'
        )
      }

      if (attributes.DepartmentId) {
        await queryInterface.renameColumn(
          'schedules',
          'DepartmentId',
          'department_id'
        )
      }
    })

    await queryInterface.describeTable('users').then(async attributes => {
      if (attributes.companyId) {
        await queryInterface.renameColumn('users', 'companyId', 'company_id')
      }

      if (attributes.DepartmentId) {
        await queryInterface.renameColumn(
          'users',
          'DepartmentId',
          'department_id'
        )
      }
    })

    await queryInterface
      .describeTable('user_allowance_adjustment')
      .then(async attributes => {
        if (attributes.companyId) {
          await queryInterface.renameColumn(
            'user_allowance_adjustment',
            'companyId',
            'company_id'
          )
        }

        if (attributes.DepartmentId) {
          await queryInterface.renameColumn(
            'user_allowance_adjustment',
            'DepartmentId',
            'department_id'
          )
        }
      })
  },

  down: function(queryInterface, Sequelize) {
    // No way back!
    return Promise.resolve()
  }
}
