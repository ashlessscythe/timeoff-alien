'use strict'

const models = require('../lib/model/db')

module.exports = {
  up: function(queryInterface, Sequelize) {
    return queryInterface
      .describeTable('leave_types')
      .then(function(attributes) {
        if (attributes.hasOwnProperty('sort_order')) {
          return 1
        }

        return queryInterface.addColumn(
          'leave_types',
          'sort_order',
          models.LeaveType.attributes.sort_order
        )
      })
  },

  down: function(queryInterface, Sequelize) {
    return queryInterface.removeColumn('leave_types', 'sort_order')
  }
}
