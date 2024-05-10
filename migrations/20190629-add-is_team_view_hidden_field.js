module.exports = {
  up: (queryInterface, Sequelize) => queryInterface.describeTable('companies').then(attributes => {
      if (attributes.hasOwnProperty('is_team_view_hidden')) {
        return Promise.resolve()
      }

      return queryInterface.addColumn(
        'companies',
        'is_team_view_hidden',
        models.Company.attributes.is_team_view_hidden
      )
    }),

  down: (queryInterface, Sequelize) =>
    queryInterface.removeColumn('companies', 'is_team_view_hidden')
}
