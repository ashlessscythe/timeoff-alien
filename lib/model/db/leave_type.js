'use strict'

module.exports = function(sequelize, DataTypes) {
  const LeaveType = sequelize.define(
    'LeaveType',
    {
      // TODO add validators!
      name: {
        type: DataTypes.STRING,
        allowNull: false
      },
      color: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: '#ffffff'
      },
      use_allowance: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      use_personal: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      limit: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      sort_order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Is used to determine sorting order of leave types'
      },
      auto_approve: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'If true, leave requests of this type will be auto-approved'
      }
    },
    {
      underscored: true
    }
  )

  LeaveType.associate = function(models) {
    LeaveType.belongsTo(models.Company, {
      as: 'company',
      foreignKey: 'company_id'
    })
    LeaveType.hasMany(models.Leave, {
      as: 'leaves',
      foreignKey: { name: 'leave_type_id', allowNull: false }
    })
  }

  LeaveType.generate_leave_types = function(args) {
    const company = args.company

    return LeaveType.bulkCreate([
      {
        name: 'Holiday',
        color: '#22AA66',
        company_id: company.id
      },
      {
        name: 'Sick Leave',
        color: '#459FF3',
        company_id: company.id,
        limit: 10,
        use_allowance: 0
      }
    ])
  }

  LeaveType.prototype.get_color_class = function() {
    const value_in_db = this.color || ''

    return value_in_db.match(/^\s*\#/) ? 'leave_type_color_1' : value_in_db
  }

  LeaveType.prototype.is_auto_approve = function() {
    return this.auto_approve === true
  }

  LeaveType.prototype.does_use_personal = function() {
    return this.does_use_personal === true
  }

  return LeaveType
}
