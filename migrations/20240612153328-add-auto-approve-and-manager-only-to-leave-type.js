'use strict'

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('leave_types', 'manager_only', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment:
        'If true, this leave type can only be used by managers/supervisors'
    })
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.query.removeColumn('leave_types', 'manager_only')
  }
}
