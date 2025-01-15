'use strict'

module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.addColumn(
      'user_allowance_adjustment',
      'personal_adjustment',
      {
        type: Sequelize.FLOAT,
        allowNull: false,
        defaultValue: 0,
        comment: 'Adjustment to personal days allowance in current year'
      }
    )
  },

  down: (queryInterface, Sequelize) => {
    return queryInterface.removeColumn(
      'user_allowance_adjustment',
      'personal_adjustment'
    )
  }
}
