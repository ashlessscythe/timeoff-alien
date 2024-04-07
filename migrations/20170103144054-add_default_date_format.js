'use strict'

module.exports = {
  up: function(queryInterface, Sequelize) {
    return queryInterface.describeTable('companies').then(function(attributes) {
      if (attributes.hasOwnProperty('date_format')) {
        return 1
      }

      return queryInterface.addColumn('companies', 'date_format', {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'YYYY-MM-DD'
      })
    })
  },

  down: function(queryInterface, Sequelize) {
    return queryInterface.removeColumn('companies', 'date_format')
  }
}
