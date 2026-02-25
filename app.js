require('dotenv').config()
const express = require('express')
const path = require('path')
const favicon = require('serve-favicon')
const logger = require('morgan')
const cookieParser = require('cookie-parser')
const bodyParser = require('body-parser')
const moment = require('moment')
const _handlebars = require('handlebars')
const compression = require('compression')
const {
  allowInsecurePrototypeAccess
} = require('@handlebars/allow-prototype-access')

const i18n = require('./i18n')
const prisma = require('./lib/prisma/client')

const app = express()

// Use compression
app.use(compression())

// Add Content Security Policy (removed since it blocks internal api req {leave reject and approve})
// app.use((req, res, next) => {
//   res.setHeader(
//     'Content-Security-Policy',
//     "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://*.cloudflareinsights.com"
//   );
//   next();
// });

// Rest of the app.js content remains unchanged
const baseHelpers = require('./lib/view/helpers')()

// View engine setup
const handlebars = require('express-handlebars').create({
  defaultLayout: 'main',
  extname: '.hbs',
  helpers: {
    ...baseHelpers,
    __: function() {
      return i18n.__.apply(this, arguments)
    },
    __n: function() {
      return i18n.__n.apply(this, arguments)
    }
  },
  handlebars: allowInsecurePrototypeAccess(_handlebars),
  runtimeOptions: {
    allowedProtoProperties: {
      full_name: true,
      name: true,
      get_leave_type_name: true,
      get_start_leave_day: true,
      get_end_leave_day: true,
      ldap_auth_enabled: true,
      get_reset_password_token: true
    },
    allowedProtoMethods: {
      full_name: true,
      name: true,
      get_leave_type_name: true,
      get_start_leave_day: true,
      get_end_leave_day: true,
      ldap_auth_enabled: true,
      get_reset_password_token: true
    }
  }
})

// Language change route
app.get('/lang/:locale', (req, res) => {
  res.cookie('lang', req.params.locale, { maxAge: 900000, httpOnly: true })
  res.redirect('back')
})

app.engine('.hbs', handlebars.engine)
app.set('view engine', '.hbs')

// Add single reference to the model into application object
// and reuse it whenever an access to DB is needed
app.set('db_model', require('./lib/model/db'))

// uncomment after placing your favicon in /public
// app.use(favicon(__dirname + '/public/favicon.ico'));

// Use 'combined' format for production logging
app.use(logger(app.get('env') === 'production' ? 'combined' : 'dev'))

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))
app.use(cookieParser())

// Serve static files with caching headers
app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: app.get('env') === 'production' ? '1d' : 0,
    setHeaders: (res, path) => {
      if (path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache')
      }
    }
  })
)

// Setup authentication mechanism
const passport = require('./lib/passport')()

const session = require('express-session')
// initalize sequelize with session store
const SequelizeStore = require('connect-session-sequelize')(session.Store)
const config = require('./lib/config')
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: config.get('sessions:ttl')
    },
    store: new SequelizeStore({
      db: app.get('db_model').sequelize,
      // Add this option to fix the Sequelize v6 compatibility issue
      // This tells connect-session-sequelize to use the Sequelize v6 API
      // instead of trying to use the removed .import method
      modelKey: 'Session'
    })
  })
)
app.use(passport.initialize())
app.use(passport.session())

// Custom middlewares
//
// Make sure session and user objects are available in templates
app.use(function(req, res, next) {
  // Get today given user's timezone
  let today

  if (req.user && req.user.company) {
    today = req.user.company.get_today()
  } else {
    today = moment.utc()
  }

  res.locals.session = req.session
  res.locals.logged_user = req.user
  res.locals.url_to_the_site_root = '/'
  // set header from env or default to static string
  res.locals.header_title = process.env.HEADER_TITLE || 'Time Off Requests'
  // set branding url
  res.locals.branding_url = process.env.BRANDING_URL || 'https://timeoff.com'
  // For book leave request modal
  res.locals.booking_start = today
  res.locals.booking_end = today
  res.locals.keep_team_view_hidden = !!(
    req.user &&
    req.user.company.is_team_view_hidden &&
    !req.user.admin
  )

  next()
})

app.use(async function(req, res, next) {
  if (!req.user) {
    res.locals.allowed_increments_by_user = {}
    res.locals.allowed_non_default_increments_by_leave_type = {}
    res.locals.minimum_days_notice_by_user_and_leave_type = {}
    return next()
  }

  try {
    let userIds = []
    if (req.user.admin) {
      const activeUsers = await prisma.users.findMany({
        where: {
          company_id: req.user.company_id,
          OR: [{ end_date: null }, { end_date: { gte: new Date() } }]
        },
        select: { id: true }
      })
      userIds = activeUsers.map(user => user.id)
    } else {
      const supervisedUsers =
        Array.isArray(req.user.supervised_users) &&
        req.user.supervised_users.length
          ? req.user.supervised_users
          : [req.user]

      userIds = Array.from(
        new Set(
          supervisedUsers
            .map(user => user && user.id)
            .filter(id => typeof id === 'number')
        )
      )
    }

    if (userIds.length === 0) {
      res.locals.allowed_increments_by_user = {}
      res.locals.minimum_days_notice_by_user_and_leave_type = {}
      return next()
    }

    const [usersWithDepartments, leaveTypes] = await Promise.all([
      prisma.users.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          departments: {
            select: {
              allowed_increments: true,
              minimum_notice_by_leave_type: true
            }
          }
        }
      }),
      prisma.leave_types.findMany({
        where: { company_id: req.user.company_id },
        select: {
          id: true,
          allow_non_default_increments: true,
          minimum_days_notice: true
        }
      })
    ])

    const allowedByUser = {}
    usersWithDepartments.forEach(user => {
      let allowed = ['full_day', 'half_day']
      if (user.departments && user.departments.allowed_increments) {
        try {
          const parsed = JSON.parse(user.departments.allowed_increments)
          if (Array.isArray(parsed) && parsed.length > 0) {
            allowed = parsed
          }
        } catch (error) {
          console.error(
            'Failed to parse allowed_increments for user ' + user.id + ':',
            error
          )
        }
      }
      allowedByUser[user.id] = allowed
    })

    res.locals.allowed_increments_by_user = allowedByUser
    const allowNonDefaultByLeaveType = {}
    leaveTypes.forEach(leaveType => {
      allowNonDefaultByLeaveType[
        leaveType.id
      ] = !!leaveType.allow_non_default_increments
    })
    res.locals.allowed_non_default_increments_by_leave_type = allowNonDefaultByLeaveType

    // Effective minimum days notice per (user, leave_type): department override or leave type default
    const minimumDaysNoticeByUserAndLeaveType = {}
    usersWithDepartments.forEach(user => {
      minimumDaysNoticeByUserAndLeaveType[user.id] = {}
      let deptNoticeMap = {}
      if (
        user.departments &&
        user.departments.minimum_notice_by_leave_type
      ) {
        try {
          const parsed = JSON.parse(
            user.departments.minimum_notice_by_leave_type
          )
          if (parsed && typeof parsed === 'object') {
            deptNoticeMap = parsed
          }
        } catch (err) {
          console.error(
            'Failed to parse minimum_notice_by_leave_type for user ' +
              user.id +
              ':',
            err
          )
        }
      }
      leaveTypes.forEach(leaveType => {
        const deptDays =
          deptNoticeMap[leaveType.id] ?? deptNoticeMap[String(leaveType.id)]
        const effective =
          deptDays !== undefined && deptDays !== null && deptDays !== ''
            ? parseInt(deptDays, 10)
            : (leaveType.minimum_days_notice ?? 0)
        minimumDaysNoticeByUserAndLeaveType[user.id][leaveType.id] = isNaN(
          effective
        )
          ? 0
          : Math.max(0, effective)
      })
    })
    res.locals.minimum_days_notice_by_user_and_leave_type =
      minimumDaysNoticeByUserAndLeaveType

    return next()
  } catch (error) {
    console.error('Failed to load allowed increments by user:', error)
    res.locals.allowed_increments_by_user = {}
    res.locals.allowed_non_default_increments_by_leave_type = {}
    res.locals.minimum_days_notice_by_user_and_leave_type = {}
    return next()
  }
})

app.use(function(_req, res, next) {
  const isProduction = app.get('env') === 'production'
  res.locals.custom_java_script = [
    '/js/bootstrap-datepicker.js',
    '/js/popover-initializer.js', // popups
    isProduction ? '/js/global.min.js' : '/js/global.js'
  ]
  res.locals.custom_css = ['/css/bootstrap-datepicker3.standalone.css']
  if (isProduction) {
    res.locals.custom_css.push('/css/style.min.css')
  } else {
    res.locals.custom_css.push('/css/style.css')
  }
  next()
})

// Enable flash messages within session
app.use(require('./lib/middleware/flash_messages'))

app.use(require('./lib/middleware/session_aware_redirect'))

// Here will be publicly accessible routes

app.use('/feed/', require('./lib/route/feed'))

app.use('/integration/v1/', require('./lib/route/integration_api')(passport))

// Terms of Service route
app.use('/', require('./lib/route/terms'))

app.use(
  '/',
  require('./lib/route/login')(passport),

  // All rotes bellow are only for authenticated users
  require('./lib/route/dashboard')
)

app.use('/api/v1/', require('./lib/route/api'))
app.use('/api/v1/notifications', require('./lib/route/api/notifications'))

app.use('/calendar/', require('./lib/route/calendar'))

app.use('/settings/', require('./lib/route/settings'))

// '/settings/' path is quite big hence there are two modules providing handlers for it
app.use('/settings/', require('./lib/route/departments'))
app.use('/settings/', require('./lib/route/bankHolidays'))

app.use(
  '/users/',
  // Order of following requires for /users/ matters
  require('./lib/route/users/summary'),
  require('./lib/route/users')
)

// Prisma-based users route for performance testing
app.use('/users-prisma/', require('./lib/route/users/prisma-users'))

app.use('/requests/', require('./lib/route/requests'))

app.use('/audit/', require('./lib/route/audit'))

app.use('/reports/', require('./lib/route/reports'))

app.use('/messages/', require('./lib/route/messages'))

// catch 404
app.use(function(req, res, next) {
  res.render('not_found')
})

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use(function(err, req, res, next) {
    console.error(err)
    res.status(err.status || 500)
    res.render('error', {
      message: err.message,
      error: err
    })
  })
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
  console.error(err)
  res.status(err.status || 500)
  res.render('error', {
    message: err.message,
    error: {}
  })
})

module.exports = app
