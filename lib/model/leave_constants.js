'use strict'

/** Leave status and day-part constants (formerly Sequelize Leave statics). */
module.exports = {
  status_new: () => 1,
  status_approved: () => 2,
  status_rejected: () => 3,
  status_pended_revoke: () => 4,
  status_canceled: () => 5,
  leave_day_part_all: () => 1,
  leave_day_part_morning: () => 2,
  leave_day_part_afternoon: () => 3
}
