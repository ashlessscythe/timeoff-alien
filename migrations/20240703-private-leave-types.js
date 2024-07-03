'use strict'

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('leave_types', 'private_leave', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment:
        'If true, this leave type is private and only visible to the employee or a manager'
    })
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.query.removeColumn('leave_types', 'private_leave')
  }
}
