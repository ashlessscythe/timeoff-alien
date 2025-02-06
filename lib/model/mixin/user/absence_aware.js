'use strict'

const { sorter } = require('../../../util')
const _ = require('underscore')
const Promise = require('bluebird')
const CalendarMonth = require('../../calendar_month')
const LeaveCollectionUtil = require('../../leave_collection')()
const moment = require('moment')
const { prisma } = require('../../db/prisma')

const AbsenceAwareMixin = {
  async promise_allowance({ year }) {
    const yearStart = moment.utc(year).startOf('year').toDate()
    const yearEnd = moment.utc(year).endOf('year').toDate()

    const [user, department] = await Promise.all([
      prisma.users.findUnique({
        where: { id: this.id },
        include: {
          my_leaves: {
            where: {
              OR: [
                {
                  date_start: {
                    gte: yearStart,
                    lte: yearEnd
                  }
                },
                {
                  date_end: {
                    gte: yearStart,
                    lte: yearEnd
                  }
                }
              ]
            },
            include: {
              leave_type: true
            }
          }
        }
      }),
      prisma.departments.findUnique({
        where: { id: this.department_id }
      })
    ])

    const allowance = department.allowance
    const adjustment = await this.promise_adjustment_for_year(year)
    const total = allowance + (adjustment || 0)

    const used = this.calculate_number_of_days_taken_from_allowance({
      year: year.format('YYYY'),
      ignore_allowance: true
    })

    return {
      allowance,
      adjustment,
      total_days: total,
      number_of_days_taken_from_allowance: used,
      number_of_days_available_in_allowance: total - used,
      manual_adjustment: adjustment,
      carry_over: 0 // TODO: Implement carry over calculation
    }
  },

  async promise_adjustment_for_year(year) {
    const adjustment = await prisma.adjustments.findFirst({
      where: {
        user_id: this.id,
        year: year.format('YYYY')
      }
    })
    return adjustment?.days || 0
  },

  async promise_schedule_I_obey() {
    const schedule = await prisma.schedules.findFirst({
      where: {
        OR: [
          { user_id: this.id },
          { company_id: this.company_id }
        ]
      },
      orderBy: {
        user_id: 'desc' // User schedule takes precedence over company schedule
      }
    })
    return schedule || {
      monday: 1,
      tuesday: 1,
      wednesday: 1,
      thursday: 1,
      friday: 1,
      saturday: 2,
      sunday: 2
    }
  },

  async reload_with_leave_details({ year }) {
    const yearStart = moment.utc(year).startOf('year').toDate()
    const yearEnd = moment.utc(year).endOf('year').toDate()

    const userWithLeaves = await prisma.users.findUnique({
      where: { id: this.id },
      include: {
        leaves_leaves_user_idTousers: {
          where: {
            OR: [
              {
                date_start: {
                  gte: yearStart,
                  lte: yearEnd
                }
              },
              {
                date_end: {
                  gte: yearStart,
                  lte: yearEnd
                }
              }
            ]
          },
          include: {
            leave_types: true
          }
        }
      }
    })

    this.my_leaves = userWithLeaves.leaves_leaves_user_idTousers
    return this
  },

  _get_calendar_months_to_show({ year, show_full_year }) {
    if (show_full_year) {
      return _.map([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], i =>
        moment.utc(year.format('YYYY') + '-' + i + '-01')
      )
    }

    return _.map([0, 1, 2, 3], delta =>
      this.company
        .get_today()
        .add(delta, 'months')
        .startOf('month')
    )
  },

  async promise_calendar(args) {
    const year = args.year || this.company.get_today()
    const show_full_year = args.show_full_year || false
    const is_multi_year = this.company.get_today().month() > 8

    const months_to_show = this._get_calendar_months_to_show({
      year: year.clone(),
      show_full_year
    })

    const [department, company, leaves, schedule] = await Promise.all([
      prisma.departments.findUnique({
        where: { id: this.department_id }
      }),
      prisma.companies.findUnique({
        where: { id: this.company_id },
        include: {
          bank_holidays: true,
          leave_types: true
        }
      }),
      prisma.leaves.findMany({
        where: {
          user_id: this.id,
          NOT: [
            { status: 3 }, // rejected
            { status: 4 } // canceled
          ],
          OR: [
            {
              date_start: {
                gte: moment
                  .utc(year)
                  .startOf('year')
                  .toDate(),
                lte: moment
                  .utc(year.clone().add(is_multi_year ? 1 : 0, 'years'))
                  .endOf('year')
                  .toDate()
              }
            },
            {
              date_end: {
                gte: moment
                  .utc(year)
                  .startOf('year')
                  .toDate(),
                lte: moment
                  .utc(year.clone().add(is_multi_year ? 1 : 0, 'years'))
                  .endOf('year')
                  .toDate()
              }
            }
          ]
        }
      }),
      this.promise_schedule_I_obey()
    ])

    const leave_days = _.flatten(
      _.map(leaves, leave =>
        _.map(leave.get_days(), leave_day => {
          leave_day.leave = leave
          return leave_day
        })
      )
    )

    return _.map(
      months_to_show,
      month =>
        new CalendarMonth(month, {
          bank_holidays: department.include_public_holidays
            ? company.bank_holidays
            : [],
          leave_days,
          schedule,
          today: company.get_today(),
          leave_types: company.leave_types
        })
    )
  },

  async validate_overlapping(new_leave_attributes) {
    const overlapping_leaves = await prisma.leaves.findMany({
      where: {
        user_id: this.id,
        NOT: [
          { status: 3 }, // rejected
          { status: 4 } // canceled
        ],
        OR: [
          {
            date_start: {
              gte: new Date(new_leave_attributes.from_date),
              lte: moment
                .utc(new_leave_attributes.to_date)
                .endOf('day')
                .toDate()
            }
          },
          {
            date_end: {
              gte: new Date(new_leave_attributes.from_date),
              lte: moment
                .utc(new_leave_attributes.to_date)
                .endOf('day')
                .toDate()
            }
          },
          {
            AND: [
              {
                date_start: {
                  lte: new Date(new_leave_attributes.from_date)
                }
              },
              {
                date_end: {
                  gte: new Date(new_leave_attributes.to_date)
                }
              }
            ]
          }
        ]
      }
    })

    if (overlapping_leaves.length === 0) {
      return 1
    }

    const overlapping_leave = overlapping_leaves[0]

    if (overlapping_leave.fit_with_leave_request(new_leave_attributes)) {
      return 1
    }

    const error = new Error('Overlapping booking!')
    error.user_message = 'Overlapping booking!'
    throw error
  },

  async promise_my_leaves(args) {
    const year = args?.year || moment.utc().year()
    const where = {
      user_id: this.id
    }

    if (args?.filter_status) {
      where.status = args.filter_status
    }

    if (args?.filter?.id) {
      where.id = args.filter.id
    }

    if (!args?.ignore_year) {
      where.OR = [
        {
          date_start: {
            gte: moment
              .utc(year)
              .startOf('year')
              .toDate(),
            lte: moment
              .utc(year)
              .endOf('year')
              .toDate()
          }
        },
        {
          date_end: {
            gte: moment
              .utc(year)
              .startOf('year')
              .toDate(),
            lte: moment
              .utc(year)
              .endOf('year')
              .toDate()
          }
        }
      ]
    } else if (args?.dateStart && args?.dateEnd) {
      where.OR = [
        {
          date_start: {
            gte: moment
              .utc(args.dateStart)
              .startOf('day')
              .toDate(),
            lte: moment
              .utc(args.dateEnd)
              .endOf('day')
              .toDate()
          }
        },
        {
          date_end: {
            gte: moment
              .utc(args.dateStart)
              .startOf('day')
              .toDate(),
            lte: moment
              .utc(args.dateEnd)
              .endOf('day')
              .toDate()
          }
        },
        {
          AND: [
            {
              date_start: {
                lte: moment
                  .utc(args.dateStart)
                  .startOf('day')
                  .toDate()
              }
            },
            {
              date_end: {
                gte: moment
                  .utc(args.dateEnd)
                  .endOf('day')
                  .toDate()
              }
            }
          ]
        }
      ]
    }

    const leaves = await prisma.leaves.findMany({
      where,
      include: {
        leave_type: true,
        users_leaves_user_idTousers: {
          include: {
            companies: {
              include: {
                bank_holidays: true
              }
            }
          }
        }
      }
    })

    // Set cached schedule
    leaves.forEach(leave => {
      if (leave.users_leaves_user_idTousers) {
        leave.users_leaves_user_idTousers.cached_schedule = this.cached_schedule
      }
    })

    // Get approvers
    const leavesWithApprovers = await Promise.map(
      leaves,
      async leave => {
        const approver = await leave.promise_approver()
        leave.approver = approver
        return leave
      },
      { concurrency: 10 }
    )

    // Get department
    const department = await prisma.departments.findUnique({
      where: { id: this.department_id }
    })

    leavesWithApprovers.forEach(l => {
      if (l.users_leaves_user_idTousers) {
        l.users_leaves_user_idTousers.department = department
      }
    })

    return LeaveCollectionUtil.promise_to_sort_leaves(leavesWithApprovers)
  },

  async promise_my_active_leaves(args) {
    try {
      const year = args?.year || moment.utc().year()

      const leaves = await this.promise_my_leaves({
        year,
        filter_status: [1, 2, 6] // new, approved, pended_revoke
      })

      return LeaveCollectionUtil.promise_to_sort_leaves(leaves)
    } catch (err) {
      console.error('Error in promise_my_active_leaves:', err)
      throw err
    }
  },

  async getMyActiveLeavesForDateRange({ dateStart, dateEnd }) {
    const rawLeaves = await this.promise_my_leaves({
      ignore_year: true,
      dateStart,
      dateEnd,
      filter_status: [1, 2, 6] // new, approved, pended_revoke
    })

    return LeaveCollectionUtil.promise_to_sort_leaves(rawLeaves)
  },

  async promise_my_active_leaves_ever() {
    const leaves = await this.promise_my_leaves({
      ignore_year: true,
      filter_status: [1, 2, 6] // new, approved, pended_revoke
    })
    return LeaveCollectionUtil.promise_to_sort_leaves(leaves)
  },

  async promise_leaves_to_be_processed() {
    const supervisedUsers = await this.promise_supervised_users()

    const leaves = await prisma.leaves.findMany({
      where: {
        status: {
          in: [1, 6] // new, pended_revoke
        },
        user_id: {
          in: supervisedUsers.map(u => u.id)
        }
      },
      include: {
        leave_type: true,
        users_leaves_user_idTousers: {
          include: {
            companies: {
              include: {
                bank_holidays: true
              }
            },
            departments: true
          }
        }
      }
    })

    await Promise.map(
      leaves,
      async leave => {
        if (leave.users_leaves_user_idTousers) {
          await leave.users_leaves_user_idTousers.promise_schedule_I_obey()
        }
      },
      { concurrency: 10 }
    )

    return LeaveCollectionUtil.promise_to_sort_leaves(leaves)
  },

  async promise_cancelable_leaves() {
    const leaves = await this.promise_my_leaves({
      ignore_year: true,
      filter_status: [1] // new
    })

    await Promise.map(
      leaves,
      async leave => {
        if (leave.user) {
          await leave.user.promise_schedule_I_obey()
        }
      },
      { concurrency: 10 }
    )

    return LeaveCollectionUtil.promise_to_sort_leaves(leaves)
  },

  calculate_number_of_days_taken_from_allowance(args) {
    const leave_type = args?.leave_type
    let leaves_to_traverse = this.my_leaves || []
    const count_personal_only = args?.count_personal || false
    const count_regular_only = args?.count_regular || false

    leaves_to_traverse.forEach(leave => {
      if (leave.user) {
        leave.user.cached_schedule = this.cached_schedule
      }
    })

    if (count_personal_only) {
      leaves_to_traverse = leaves_to_traverse.filter(
        leave => leave.leave_type?.use_personal
      )
    } else if (count_regular_only) {
      leaves_to_traverse = leaves_to_traverse.filter(
        leave => leave.leave_type && !leave.leave_type.use_personal
      )
    } else if (leave_type) {
      leaves_to_traverse = leaves_to_traverse.filter(leave =>
        leave_type.use_personal
          ? leave.leave_type?.use_personal
          : leave.leaveTypeId === leave_type.id
      )
    }

    return (
      leaves_to_traverse.reduce((memo, leave) => {
        if (leave.is_approved_leave()) {
          return memo + leave.get_deducted_days_number(args)
        }
        return memo
      }, 0) || 0
    )
  },

  async get_leave_statistics_by_types(args = {}) {
    const statistics = {}
    const limit_by_top = args.limit_by_top || false
    const year = args.year || moment.utc().year()

    const company = await this.get_company_with_all_leave_types()

    // Initialize statistics
    for (const leave_type of company.leave_types) {
      const initial_stat = {
        leave_type,
        days_taken: 0
      }
      initial_stat.limit = leave_type.limit || 0

      if (leave_type.use_personal) {
        const personal_adjustment = await this.promise_personal_adjustment_for_year(
          year
        )
        initial_stat.limit =
          this.department.personal + (personal_adjustment || 0)
      }

      statistics[leave_type.id] = initial_stat
    }

    // Calculate days taken
    const approved_leaves = _.filter(this.my_leaves, leave =>
      leave.is_approved_leave()
    )

    approved_leaves.forEach(leave => {
      const stat_obj = statistics[leave.leave_type.id]
      if (stat_obj) {
        stat_obj.days_taken += leave.get_deducted_days_number({
          ignore_allowance: true
        })
      }
    })

    let statistic_arr = Object.values(statistics)
      .sort((a, b) => sorter(a.days_taken, b.days_taken))
      .reverse()

    if (limit_by_top) {
      statistic_arr = _.first(statistic_arr, 4)
    }

    return statistic_arr.sort((a, b) =>
      sorter(a.leave_type.name, b.leave_type.name)
    )
  },

  async validate_leave_fits_into_remaining_allowance({
    leave_type,
    leave,
    year
  }) {
    year = year || moment.utc(leave.date_start)

    const employee = await this.reload_with_leave_details({
      year: year.clone()
    })
    await employee.reload_with_session_details()
    await employee.company.reload_with_bank_holidays()

    const allowance = await employee.promise_allowance({ year })
    const days_remaining = allowance.number_of_days_available_in_allowance

    const deducted_days = leave.get_deducted_days_number({
      year: year.format('YYYY'),
      user: employee,
      leave_type
    })

    if (days_remaining - deducted_days < 0) {
      const error = new Error(
        'Requested absence is longer than remaining allowance'
      )
      error.user_message = error.toString()
      throw error
    }

    // Check leave type limits
    let effectiveLimit = leave_type.limit || 0
    if (leave_type.use_personal) {
      const personal_adjustment = await employee.promise_personal_adjustment_for_year(
        year.format('YYYY')
      )
      effectiveLimit = employee.department.personal + (personal_adjustment || 0)
    }

    if (effectiveLimit > 0) {
      const days_taken = employee.calculate_number_of_days_taken_from_allowance(
        {
          year: year.format('YYYY'),
          leave_type,
          ignore_allowance: true
        }
      )
      const days_deducted = leave.get_deducted_days_number({
        year: year.format('YYYY'),
        user: employee,
        leave_type,
        ignore_allowance: true
      })
      const would_be_used = days_taken + days_deducted

      if (would_be_used > effectiveLimit) {
        const error = new Error('Not enough (' + leave_type.name + ') days.')
        error.user_message = error.toString()
        throw error
      }
    }
  }
}

module.exports = AbsenceAwareMixin
