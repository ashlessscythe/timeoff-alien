'use strict'

const models = require('../lib/model/db')

module.exports = {
  up: function(queryInterface, Sequelize) {
    return queryInterface.describeTable('companies').then(function(attributes) {
      if (attributes.hasOwnProperty('mode')) {
        return 1
      }

      return queryInterface.addColumn(
        'companies',
        'mode',
        models.Company.attributes.mode
      )
    })
  },

  down: function(queryInterface, Sequelize) {
    return queryInterface.removeColumn('companies', 'mode')
  }
}
