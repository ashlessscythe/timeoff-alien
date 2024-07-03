'use strict'

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Check if the column already exists before adding it
    const tableInfo = await queryInterface.describeTable('companies')
    if (!tableInfo['last_name_first']) {
      await queryInterface.addColumn('companies', 'last_name_first', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment:
          'If true, last name is displayed before first name in the employee list'
      })
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('companies', 'last_name_first')
  }
}
