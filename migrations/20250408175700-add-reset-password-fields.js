'use strict'

module.exports = {
  up: function(queryInterface, Sequelize) {
    return Promise.all([
      queryInterface.addColumn('users', 'reset_password_token', {
        type: Sequelize.STRING,
        allowNull: true
      }),
      queryInterface.addColumn('users', 'reset_password_expires', {
        type: Sequelize.DATE,
        allowNull: true
      })
    ])
  },

  down: function(queryInterface, Sequelize) {
    return Promise.all([
      queryInterface.removeColumn('users', 'reset_password_token'),
      queryInterface.removeColumn('users', 'reset_password_expires')
    ])
  }
}
