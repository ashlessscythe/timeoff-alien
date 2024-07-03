'use strict'

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Check if the column already exists before adding it
    const tableInfo = await queryInterface.describeTable('leave_types')
    if (!tableInfo['manager_only']) {
      await queryInterface.addColumn('leave_types', 'manager_only', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment:
          'If true, this leave type can only be used by managers/supervisors'
      })
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('leave_types', 'manager_only')
  }
}
