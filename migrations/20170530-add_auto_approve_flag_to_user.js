'use strict'

const models = require('../lib/model/db')

module.exports = {
  up: function(queryInterface, Sequelize) {
    return queryInterface.describeTable('users').then(function(attributes) {
      if (attributes.hasOwnProperty('auto_approve')) {
        return 1
      }

      return queryInterface.addColumn(
        'users',
        'auto_approve',
        models.User.attributes.auto_approve
      )
    })
  },

  down: function(queryInterface, Sequelize) {
    return queryInterface.removeColumn('users', 'auto_approve')
  }
}
