'use strict'

const models = require('../lib/model/db')

module.exports = {
  up: function(queryInterface, Sequelize) {
    return queryInterface.describeTable('companies').then(function(attributes) {
      if (attributes.hasOwnProperty('company_wide_message')) {
        return 1
      }

      return queryInterface.addColumn(
        'companies',
        'company_wide_message',
        models.Company.attributes.company_wide_message
      )
    })
  },

  down: function(queryInterface, Sequelize) {
    return queryInterface.removeColumn('companies', 'company_wide_message')
  }
}
