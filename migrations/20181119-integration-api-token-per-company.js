'use strict'

const models = require('../lib/model/db')

module.exports = {
  up: (queryInterface, Sequelize) =>
    queryInterface
      .describeTable('companies')
      .then(attributes => {
        if (attributes.hasOwnProperty('integration_api_token')) {
          return 1
        }

        return queryInterface.addColumn(
          'companies',
          'integration_api_token',
          models.Company.attributes.integration_api_token
        )
      })
      .then(() =>
        queryInterface.describeTable('companies').then(attributes => {
          if (attributes.hasOwnProperty('integration_api_enabled')) {
            return 1
          }

          return queryInterface.addColumn(
            'companies',
            'integration_api_enabled',
            models.Company.attributes.integration_api_enabled
          )
        })
      ),

  down: (queryInterface, Sequelize) =>
    queryInterface
      .removeColumn('companies', 'integration_api_token')
      .then(() =>
        queryInterface.removeColumn('companies', 'integration_api_enabled')
      )
}
