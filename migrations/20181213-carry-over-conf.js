'use strict'

const models = require('../lib/model/db')

module.exports = {
  up: (queryInterface, Sequelize) =>
    queryInterface.describeTable('companies').then(attributes => {
      if (attributes.hasOwnProperty('carry_over')) {
        return 1
      }

      return queryInterface.addColumn(
        'companies',
        'carry_over',
        models.Company.attributes.carry_over
      )
    }),

  down: function(queryInterface, Sequelize) {
    return queryInterface.removeColumn('companies', 'carry_over')
  }
}
