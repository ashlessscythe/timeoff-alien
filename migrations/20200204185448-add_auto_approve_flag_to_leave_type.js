'use strict'

const models = require('../lib/model/db')

module.exports = {
  up: function(queryInterface, Sequelize) {
    return queryInterface
      .describeTable('leave_types')
      .then(function(attributes) {
        if (attributes.hasOwnProperty('auto_approve')) {
          return Promise.resolve()
        }

        return queryInterface.addColumn('leave_types', 'auto_approve', {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false
        })
      })
  },

  down: function(queryInterface, Sequelize) {
    return queryInterface.removeColumn('leave_types', 'auto_approve')
  }
}
