'use strict'

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('departments', 'allowance', {
      type: Sequelize.FLOAT,
      allowNull: false,
      defaultValue: 20
    })
    await queryInterface.changeColumn('departments', 'personal', {
      type: Sequelize.FLOAT,
      allowNull: false,
      defaultValue: 5
    })
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('departments', 'allowance', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 20
    })
    await queryInterface.changeColumn('departments', 'personal', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 5
    })
  }
}
