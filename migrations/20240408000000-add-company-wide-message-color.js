'use strict'

module.exports = {
  up: function(queryInterface, Sequelize) {
    return Promise.all([
      queryInterface.addColumn('companies', 'company_wide_message_text_color', {
        type: Sequelize.STRING(7),
        allowNull: true,
        defaultValue: '#000000'
      }),
      queryInterface.addColumn('companies', 'company_wide_message_bg_color', {
        type: Sequelize.STRING(7),
        allowNull: true,
        defaultValue: '#f2dede'
      })
    ])
  },

  down: function(queryInterface, Sequelize) {
    return Promise.all([
      queryInterface.removeColumn(
        'companies',
        'company_wide_message_text_color'
      ),
      queryInterface.removeColumn('companies', 'company_wide_message_bg_color')
    ])
  }
}
