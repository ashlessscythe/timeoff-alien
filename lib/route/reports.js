'use strict'

const express = require('express')
const router = express.Router()
const validator = require('validator')
const Promise = require('bluebird')
const moment = require('moment')
const config = require('../config')
const TeamView = require('../model/team_view')
const Exception = require('../error')
const csv = Promise.promisifyAll(require('csv'))
const _ = require('underscore')

const { fetchLeavesForLeavesReport } = require('../model/Report')
const { sorter } = require('../util')

// Make sure that current user is authorized to deal with settings
router.all(/.*/, require('../middleware/ensure_user_is_admin'))

router.get('/', (_req, res) => {
  res.render('report/index', {
    title: 'Reports | TimeOff'
  })
})

router.get('/allowancebytime/', (req, res) => {
  const start_date =
    req.query.start_date && validator.toDate(req.query.start_date)
      ? moment.utc(req.query.start_date)
      : req.user.company.get_today()

  const end_date =
    req.query.end_date && validator.toDate(req.query.end_date)
      ? moment.utc(req.query.end_date)
      : req.user.company.get_today()

  const team_view = new TeamView({
    user: req.user,
    start_date,
    end_date
  })

  const current_deparment_id =
    typeof req.query.department === 'number' ||
    (req.query.department && validator.isNumeric(req.query.department))
      ? req.query.department
      : null

  Promise.join(
    team_view.promise_team_view_details({
      department_id: current_deparment_id
    }),
    req.user.get_company_with_all_leave_types(),
    (team_view_details, company) =>
      team_view
        .inject_statistics({
          team_view_details,
          leave_types: company.leave_types
        })
        .then(team_view_details =>
          render_allowancebytime({
            params: req.query,
            session: req.session,
            res,
            team_view_details,
            company,
            start_date,
            end_date
          })
        )
  ).catch(error => {
    console.error(
      'An error occured when user ' +
        req.user.id +
        ' tried to access /reports/allowancebytime page: ',
      error,
      error.stack
    )

    let user_error_message =
      'Failed to produce report. Please contact administrator.'
    // By default go back to root report page
    let redirect_path = '../'

    if (error.tom_error) {
      user_error_message = Exception.extract_user_error_message(error)

      // If it is known error: stay on current page
      redirect_path = './'
    }

    req.session.flash_error(user_error_message)

    return res.redirect_with_session(redirect_path)
  })
})

function render_allowancebytime(args) {
  const params = args.params
  const session = args.session
  const res = args.res
  const team_view_details = args.team_view_details
  const company = args.company
  const start_date = args.start_date
  const end_date = args.end_date

  return Promise.try(() =>
    params['as-csv']
      ? render_allowancebytime_as_csv(args)
      : res.render('report/allowancebytime', {
          users_and_leaves: team_view_details.users_and_leaves,
          related_departments: team_view_details.related_departments,
          current_department: team_view_details.current_department,
          company,
          start_date_str: start_date.format('YYYY-MM'),
          end_date_str: end_date.format('YYYY-MM'),
          start_date_obj: start_date,
          end_date_obj: end_date,
          same_month: start_date.format('YYYYMM') === end_date.format('YYYYMM'),
          title: 'Reports - Allowance by time | TimeOff'
        })
  )
}

function render_allowancebytime_as_csv(args) {
  const params = args.params
  const session = args.session
  const res = args.res
  const team_view_details = args.team_view_details
  const company = args.company
  const start_date = args.start_date
  const end_date = args.end_date

  // Compose file name
  res.attachment(
    company.name_for_machine() +
      '_employee_allowances_between' +
      start_date.format('YYYY_MM') +
      '_and_' +
      end_date.format('YYYY_MM') +
      '.csv'
  )

  // Compose result CSV header
  const content = [
    ['email', 'last name', 'name']
      // Add dynamic list of Leave Types
      .concat(
        team_view_details.users_and_leaves.length > 0
          ? team_view_details.users_and_leaves[0].statistics.leave_type_break_down.pretty_version.map(
              it => it.name
            )
          : []
      )
      .concat(['days deducted from allowance'])
  ]

  // ... and body
  team_view_details.users_and_leaves.forEach(ul => {
    content.push(
      [ul.user.email, ul.user.lastname, ul.user.name]
        // Dynamic part of the column list
        .concat(
          ul.statistics.leave_type_break_down.pretty_version.map(it => it.stat)
        )
        .concat([ul.statistics.deducted_days])
    )
  })

  return csv
    .stringifyAsync(content)
    .then(csv_data_string => res.send(csv_data_string))
}

const extractParametersForLeavesReport = ({ req, actingUser }) => {
  const { start_date, end_date, department, leave_type } = req.query;

  const today = moment.utc(actingUser.company.get_today());

  const startDate = start_date && validator.isDate(start_date)
    ? moment.utc(start_date)
    : today.clone().startOf('day');

  const endDate = end_date && validator.isDate(end_date)
    ? moment.utc(end_date)
    : today.clone().endOf('day');

  const departmentId = department && validator.isNumeric(department.toString())
    ? department
    : null;

  const leaveTypeId = leave_type && validator.isNumeric(leave_type.toString())
    ? leave_type
    : null;

  return { startDate, endDate, departmentId, leaveTypeId };
};

const renderLeavesReportAsCsv = async ({
  res,
  company,
  startDate,
  endDate,
  leaves
}) => {
  // Compose file name
  res.attachment(
    `${company.name_for_machine()}_leaves_report_between_${startDate.format(
      'YYYY_MM_DD'
    )}_and_${endDate.format('YYYY_MM_DD')}.csv`
  )

  // Compose result CSV header
  const content = [
    [
      'Employee',
      'Department',
      'Leave Type',
      'Deducted days',
      'From',
      'To',
      'Status',
      'Requested On',
      'Approved By',
      'Requestor Comment',
      'Approver Comment'
    ]
  ]

  // ... and body
  content.push(
    ...leaves.map(
      ({
        employeeFullName,
        departmentName,
        type,
        deductedDays,
        startDate,
        endDate,
        status,
        createdAt,
        approver,
        employee_comment,
        approver_comment
      }) => [
        employeeFullName,
        departmentName,
        type,
        deductedDays,
        startDate,
        endDate,
        status,
        createdAt,
        approver,
        employee_comment,
        approver_comment
      ]
    )
  )

  const csvString = await csv.stringifyAsync(content)

  return res.send(csvString)
}

const defaultSortAttributeForLeaveReport = 'employeeFullName'
const sortersForLeavesReport = {
  employeeFullName: (a, b) => sorter(a.employeeLastName, b.employeeLastName),
  departmentName: (a, b) => sorter(a.departmentName, b.departmentName),
  type: (a, b) => sorter(a.type, b.type),
  startDate: (a, b) =>
    moment
      .utc(a.startDate)
      .toDate()
      .valueOf() -
    moment
      .utc(b.startDate)
      .toDate()
      .valueOf(),
  endDate: (a, b) =>
    moment
      .utc(a.endDate)
      .toDate()
      .valueOf() -
    moment
      .utc(b.endDate)
      .toDate()
      .valueOf(),
  status: (a, b) => sorter(a.status, b.status),
  createdAt: (a, b) =>
    moment
      .utc(a.createdAt)
      .toDate()
      .valueOf() -
    moment
      .utc(b.createdAt)
      .toDate()
      .valueOf(),
  approver: (a, b) => sorter(a.approver, b.approver)
}

const getSorterForLeaves = (attribute = defaultSortAttributeForLeaveReport) =>
  sortersForLeavesReport[attribute] ||
  sortersForLeavesReport[defaultSortAttributeForLeaveReport]

router.get('/leaves/', async (req, res) => {
  const actingUser = req.user;
  const dbModel = req.app.get('db_model');
  const renderAsCsv = !!req.query['as-csv'];
  const sortBy = req.query.sort_by || defaultSortAttributeForLeaveReport;

  const {
    startDate,
    endDate,
    departmentId,
    leaveTypeId
  } = extractParametersForLeavesReport({ req, actingUser });

  try {
    const { leaves } = await fetchLeavesForLeavesReport({
      actingUser,
      dbModel,
      startDate,
      endDate,
      departmentId,
      leaveTypeId
    });

    const sortedLeaves = leaves.sort(getSorterForLeaves(sortBy));

    const company = await actingUser.getCompany({
      scope: ['with_leave_types', 'with_simple_departments']
    });

    if (renderAsCsv) {
      await renderLeavesReportAsCsv({ res, company, startDate, endDate, leaves: sortedLeaves });
    } else {
      res.render('report/leaves', {
        leaves: sortedLeaves,
        departmentId,
        leaveTypeId,
        sortBy,
        startDateObj: startDate,
        endDateObj: endDate,
        startDateStr: startDate.format('YYYY-MM-DD'),
        endDateStr: endDate.format('YYYY-MM-DD'),
        company: actingUser.company,
        leaveTypes: company.leave_types
          ? company.leave_types
              .map(lt => ({ ...lt.toJSON(), id: `${lt.id}` }))
              .sort((a, b) => sorter(a.name, b.name))
          : [],
        departments: company.departments
          ? company.departments
              .map(d => ({ ...d.toJSON(), id: `${d.id}` }))
              .sort((a, b) => sorter(a.name, b.name))
          : []
      });
    }
  } catch (error) {
    console.error(
      `An error occurred when user ${actingUser.id} tried to access /reports/leaves/ page: ${error} at ${error.stack}`
    );

    const userErrorMessage = error.tom_error
      ? Exception.extract_user_error_message(error)
      : 'Failed to produce Leaves report. Please contact administrator.';

    req.session.flash_error(userErrorMessage);

    return res.redirect_with_session(error.tom_error ? './' : '../');
  }
});

module.exports = router
