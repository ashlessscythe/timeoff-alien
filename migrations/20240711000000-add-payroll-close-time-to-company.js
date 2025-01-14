'use strict'

module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.addColumn('Companies', 'payroll_close_time', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 10, // Default to 10am UTC (3am UTC-7)
      comment: 'Hour in UTC when payroll closes on Monday (0-23)'
    })
  },

  down: (queryInterface, Sequelize) => {
    return queryInterface.removeColumn('Companies', 'payroll_close_time')
  }
}
