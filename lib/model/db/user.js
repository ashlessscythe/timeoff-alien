'use strict'

const bcrypt = require('bcrypt')
const _ = require('underscore')
const moment = require('moment')
const Promise = require('bluebird')
const config = require('../../config')
const UserAllowance = require('../user_allowance')
const htmlToText = require('html-to-text')
const crypto = require('crypto')
// User mixins
const withCompanyAwareness = require('../mixin/user/company_aware')
const withAbsenceAwareness = require('../mixin/user/absence_aware')
const Sequelize = require('sequelize')
const Op = Sequelize.Op
const { sorter } = require('../../util')

const LeaveCollectionUtil = require('../leave_collection')()

module.exports = function(sequelize, DataTypes) {
  const instance_methods = get_instance_methods(sequelize)

  withCompanyAwareness.call(instance_methods, sequelize)
  withAbsenceAwareness.call(instance_methods, sequelize)

  const class_methods = get_class_methods(sequelize)

  withAssociations.call(class_methods, sequelize)
  withScopes.call(class_methods, sequelize)

  const User = sequelize.define(
    'User',
    {
      // TODO add validators!
      email: {
        type: DataTypes.STRING,
        allowNull: false
      },
      slack_username: {
        type: DataTypes.STRING,
        defaultValue: '', // Migration will not run without a default value. I don't understand why.
        allowNull: true
      },
      password: {
        type: DataTypes.STRING,
        allowNull: false
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false
      },
      lastname: {
        type: DataTypes.STRING,
        allowNull: false
      },
      activated: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'This flag means that user account was activated, e.g. login'
      },
      admin: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Indicate if account can edit company wide settings'
      },
      manager: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Indicate if semi admin, department manager'
      },
      auto_approve: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment:
          'Indicate if leave request from current employee are auto approved'
      },
      reset_password_token: {
        type: DataTypes.STRING,
        allowNull: true
      },
      reset_password_expires: {
        type: DataTypes.DATE,
        allowNull: true
      },
      start_date: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment: 'Date employee start to work for company',
        get: function() {
          return moment
            .utc(this.getDataValue('start_date'))
            .format('YYYY-MM-DD')
        }
      },
      end_date: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
        comment: 'Date emplyee stop working for company',
        get: function() {
          const endDate = this.getDataValue('end_date')
          if (!endDate) {
            return endDate
          }

          return moment.utc(endDate).format('YYYY-MM-DD')
        }
      }
    },
    {
      underscored: true,
      indexes: [
        {
          fields: ['company_id']
        },
        {
          fields: ['department_id']
        },
        {
          fields: ['lastname']
        }
      ],
      hooks: {
        beforeDestroy(user, options) {
          sequelize.models.DepartmentSupervisor.destroy({
            where: { user_id: user.id }
          })
          sequelize.models.Leave.destroy({ where: { user_id: user.id } })
          sequelize.models.Schedule.destroy({ where: { user_id: user.id } })
          sequelize.models.Comment.destroy({ where: { by_user_id: user.id } })
          sequelize.models.UserFeed.destroy({ where: { user_id: user.id } })
          sequelize.models.UserAllowanceAdjustment.destroy({
            where: { user_id: user.id }
          })
          sequelize.models.EmailAudit.destroy({ where: { user_id: user.id } })
        }
      }
    }
  )

  Object.assign(User, class_methods)
  Object.assign(User.prototype, instance_methods)

  function get_instance_methods(sequelize) {
    return {
      is_my_password: function(password) {
        return sequelize.models.User.verify_password(password, this.password)
      },

      maybe_activate: function() {
        if (!this.activated) {
          this.activated = true
        }
        return this.save()
      },

      is_admin: function() {
        return this.admin === true
      },

      is_manager: function() {
        return this.manager === true
      },

      is_auto_approve: function() {
        return this.auto_approve === true
      },

      full_name: function() {
        return this.name + ' ' + this.lastname
      },

      is_active: function() {
        return this.end_date === null || moment(this.end_date).isAfter(moment())
      },

      promise_users_I_can_manage: async function() {
        const self = this

        let users = []

        if (self.is_admin()) {
          const company = await self.getCompany({
            scope: ['with_all_users']
          })

          users = company.users
        } else {
          const departments = await self.promise_supervised_departments()

          users = departments.map(({ users }) => users).flat()
        }

        users.push(self)
        users = _.uniq(users, ({ id }) => id)
        users = users.sort((a, b) => sorter(a.lastname, b.lastname))

        return users
      },

      promise_manager: function() {
        return this.getDepartment({
          scope: ['with_manager']
        }).then(department => Promise.resolve(department.manager))
      },

      promise_supervisors: function() {
        return this.getDepartment({
          scope: ['with_manager', 'with_supervisors']
        }).then(department => {
          // Handle case where department might be null
          if (!department) {
            console.log('Warning: Department not found for user')
            return Promise.resolve([])
          }

          // Create an array with manager if it exists
          const managerArray = department.manager ? [department.manager] : []

          // Ensure supervisors is an array
          const supervisorsArray = Array.isArray(department.supervisors)
            ? department.supervisors
            : []

          // Combine and return
          return Promise.resolve([...managerArray, ...supervisorsArray])
        })
      },

      promise_supervised_departments: function() {
        const self = this

        return sequelize.models.DepartmentSupervisor.findAll({
          where: { user_id: self.id }
        })
          .then(department_supervisors =>
            department_supervisors.map(obj => obj.department_id)
          )
          .then(department_ids => {
            if (!department_ids) {
              department_ids = []
            }

            return sequelize.models.Department.scope(
              'with_simple_users'
            ).findAll({
              where: {
                [Op.or]: [
                  { id: { [Op.in]: department_ids } },
                  { manager_id: self.id }
                ]
              }
            })
          })
          .catch(error => {
            console.error(
              'Unable to retrieve DepartmentSupervisor for user_id=' +
                self.id +
                ' : ' +
                error,
              error.stack
            )
            return error
          })
      },

      promise_supervised_users: function() {
        const self = this

        return self.promise_supervised_departments().then(departments =>
          self.sequelize.models.User.findAll({
            where: { department_id: departments.map(d => d.id) }
          })
        )
      },

      promise_personal_adjustment_for_year: function(year) {
        return this.sequelize.models.UserAllowanceAdjustment.findOne({
          where: {
            user_id: this.id,
            year: year
          }
        }).then(adjustment => {
          if (adjustment && adjustment.personal_adjustment !== null) {
            return Promise.resolve(adjustment.personal_adjustment)
          }
          return Promise.resolve(0)
        })
      },

      promise_allowance: function(args) {
        args = args || {}
        args.user = this
        return UserAllowance.promise_allowance(args)
      },

      reload_with_leave_details: function(args) {
        const self = this
        const dbModel = self.sequelize.models

        return Promise.all([
          self
            .promise_my_active_leaves(args)
            .then(leaves =>
              LeaveCollectionUtil.enrichLeavesWithComments({ leaves, dbModel })
            ),
          self.getDepartment(),
          self.promise_schedule_I_obey()
        ])
          .then(([leaves, department, schedule]) => {
            self.my_leaves = leaves
            self.department = department
            return self
          })
          .catch(error => {
            console.error(
              'Unable to load leaves details for user ' +
                self.email +
                ' : ' +
                error,
              error.stack
            )
            return Promise.reject(error)
          })
      },

      reload_with_session_details: function() {
        const self = this

        return Promise.join(
          self.promise_users_I_can_manage(),
          self.get_company_with_all_leave_types(),
          self.promise_schedule_I_obey(),
          (users, company, schedule) => {
            self.supervised_users = users || []
            self.company = company
            return Promise.resolve(self)
          }
        ).catch(error => {
          console.error(
            'Unable to load session details for user ' +
              self.email +
              ' : ' +
              error,
            error.stack
          )
          return Promise.reject(error)
        })
      },

      remove: function() {
        const self = this

        if (self.is_admin()) {
          throw new Error('Cannot remove administrator user')
        }

        return self
          .promise_supervised_departments()
          .then(departments => {
            if (departments.length > 0) {
              throw new Error('Cannot remove supervisor')
            }

            return self.getMy_leaves()
          })
          .then(leaves => Promise.all(_.map(leaves, leave => leave.destroy())))
          .then(() => self.destroy())
      },

      get_reset_password_token: function() {
        const self = this

        // Generate a secure random token
        const token = crypto.randomBytes(32).toString('hex')

        // Set expiration time (24 hours from now)
        const expires = moment()
          .add(3, 'hour')
          .toDate()

        // Save token and expiration to user
        self.reset_password_token = token
        self.reset_password_expires = expires

        return self.save().then(() => token)
      },

      record_email_addressed_to_me: function(email_obj) {
        if (
          !email_obj ||
          !email_obj.hasOwnProperty('subject') ||
          !email_obj.subject ||
          !email_obj.hasOwnProperty('body') ||
          !email_obj.body
        ) {
          throw new Error(
            'Got incorrect parameters. There should be an object ' +
              'to represent and email and contain subject and body'
          )
        }

        const promise_action = this.sequelize.models.EmailAudit.create({
          email: this.email,
          subject: htmlToText.fromString(email_obj.subject),
          body: htmlToText.fromString(email_obj.body),
          user_id: this.id,
          company_id: this.company_id
        })

        return promise_action
      },

      promise_to_update_personal_adjustment: function(args) {
        const self = this

        if (!args.year || !args.hasOwnProperty('adjustment')) {
          return Promise.reject(
            new Error(
              'User.promise_to_update_personal_adjustment needs year and adjustment parameters'
            )
          )
        }

        // Add retry to handle transient SQLITE_BUSY
        const attempt = retries => {
          return self.sequelize.models.UserAllowanceAdjustment.findOrCreate({
            where: {
              user_id: self.id,
              year: args.year
            },
            defaults: { personal_adjustment: args.adjustment }
          })
            .then(([adjustment, created]) => {
              if (!created) {
                adjustment.personal_adjustment = args.adjustment
                return adjustment.save()
              }
              return Promise.resolve(adjustment)
            })
            .catch(err => {
              const isBusy =
                err &&
                (err.name === 'SequelizeTimeoutError' ||
                  (err.parent && err.parent.code === 'SQLITE_BUSY'))
              if (isBusy && retries > 0) {
                const delay = 200 * (4 - retries)
                return Promise.delay(delay).then(() => attempt(retries - 1))
              }
              throw err
            })
        }

        return attempt(3)
      },

      promise_schedule_I_obey: function() {
        const self = this

        if (self.cached_schedule) {
          return Promise.resolve(self.cached_schedule)
        }

        return self.sequelize.models.Schedule.findAll({
          where: {
            [Op.or]: [{ user_id: self.id }, { company_id: self.company_id }]
          }
        }).then(schedules => {
          if (schedules.length === 0) {
            return self.sequelize.models.Schedule.promise_to_build_default_for({
              company_id: self.company_id
            }).then(sch => {
              self.cached_schedule = sch
              return Promise.resolve(sch)
            })
          }

          if (schedules.length === 2) {
            return Promise.resolve(
              _.find(schedules, sch => sch.is_user_specific())
            ).then(sch => {
              self.cached_schedule = sch
              return Promise.resolve(sch)
            })
          }

          return Promise.resolve(schedules.pop()).then(sch => {
            self.cached_schedule = sch
            return Promise.resolve(sch)
          })
        })
      }
    }
  }

  function get_class_methods(sequelize) {
    return {
      hashify_password: function(password) {
        const SALT_ROUNDS = 12
        return bcrypt.hashSync(password, SALT_ROUNDS)
      },

      verify_password: function(password, hash) {
        return bcrypt.compareSync(password, hash)
      },

      get_user_by_reset_password_token: function(token) {
        const self = this

        return self
          .findOne({
            where: {
              reset_password_token: token,
              reset_password_expires: {
                [Op.gt]: new Date() // Token must not be expired
              }
            }
          })
          .then(user => {
            if (!user) {
              return Promise.resolve()
            }
            return Promise.resolve(user)
          })
      },

      find_by_email: function(email) {
        const condition = { email }
        const active_users_filter = this.get_active_user_filter()
        for (const attrname in active_users_filter) {
          condition[attrname] = active_users_filter[attrname]
        }

        return this.findOne({ where: condition })
      },

      find_by_id: function(id) {
        return this.findOne({ where: { id } })
      },

      register_new_admin_user: function(attributes) {
        attributes.password = this.hashify_password(attributes.password)

        let new_departments
        let new_user
        const country_code = attributes.country_code
        const timezone = attributes.timezone
        const company_name = attributes.company_name

        delete attributes.company_name
        delete attributes.country_code

        return sequelize.models.User.find_by_email(attributes.email)
          .then(existing_user => {
            if (existing_user) {
              const error = new Error('Email is already used')
              error.show_to_user = true
              throw error
            }

            if (attributes.name.toLowerCase().indexOf('http') >= 0) {
              const error = new Error('Name cannot have links')
              error.show_to_user = true
              throw error
            }

            return sequelize.models.Company.create_default_company({
              name: company_name,
              country_code,
              timezone
            })
          })
          .then(company => {
            attributes.company_id = company.id
            attributes.admin = true

            return company.getDepartments()
          })
          .then(departments => {
            new_departments = departments
            attributes.department_id = departments[0].id
            return sequelize.models.User.create(attributes)
          })
          .then(user => {
            new_user = user

            return Promise.all(
              _.map(new_departments, department => {
                department.manager_id = user.id
                return department.save()
              })
            )
          })
          .then(() => Promise.resolve(new_user))
      },

      get_active_user_filter: function() {
        return {
          [Op.or]: [
            { end_date: { [Op.eq]: null } },
            {
              end_date: {
                [Op.gte]: moment
                  .utc()
                  .startOf('day')
                  .format('YYYY-MM-DD')
              }
            }
          ]
        }
      }
    }
  }

  function withAssociations() {
    this.associate = function(models) {
      models.User.belongsTo(models.Company, {
        as: 'company',
        foreignKey: { name: 'company_id', allowNull: false }
      })
      models.User.belongsTo(models.Department, {
        as: 'department',
        foreignKey: { name: 'department_id', allowNull: false }
      })
      models.User.hasMany(models.Leave, {
        as: 'my_leaves',
        foreignKey: { name: 'user_id', allowNull: false }
      })
      models.User.hasMany(models.UserFeed, {
        as: 'feeds',
        foreignKey: { name: 'user_id', allowNull: false }
      })
      models.User.hasMany(models.UserAllowanceAdjustment, {
        as: 'adjustments',
        foreignKey: { name: 'user_id', allowNull: false }
      })
    }
  }

  function withScopes() {
    this.loadScope = function(models) {
      models.User.addScope('active', () => ({
        where: models.User.get_active_user_filter()
      }))

      models.User.addScope('withDepartments', {
        include: [
          {
            model: models.Department,
            as: 'department'
          }
        ]
      })

      models.User.addScope('with_simple_leaves', () => ({
        include: [
          {
            model: models.Leave,
            as: 'my_leaves',
            where: {
              [Op.and]: [
                { status: { [Op.ne]: models.Leave.status_rejected() } },
                { status: { [Op.ne]: models.Leave.status_canceled() } }
              ]
            }
          }
        ]
      }))
    }
  }

  return User
}
