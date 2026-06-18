/*
 * Book Leave request pop-up window.
 *
 * */
$(document).ready(function() {
  /*
   *  When FROM field in New absense form changes: update TO one if necessary
   */
  $('input.book-leave-from-input').on('change', function(e) {
    e.stopPropagation()

    const from_date = $('input.book-leave-from-input').datepicker('getDate')

    if (!from_date) {
      // no new value for FROM part, do nothing
      console.log('No from date')
      return
    }

    const to_date = $('input.book-leave-to-input').datepicker('getDate')

    if (!to_date || (to_date && to_date.getTime() < from_date.getTime())) {
      $('input.book-leave-to-input').datepicker(
        'setDate',
        $('input.book-leave-from-input').datepicker('getFormattedDate')
      )
    }
  })
})

/*
 * Bootstrap-datepicker
 *
 * */
!(function(a) {
  a.fn.datepicker.dates['en-GB'] = {
    days: [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday'
    ],
    daysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    daysMin: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
    months: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December'
    ],
    monthsShort: [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec'
    ],
    today: 'Today',
    monthsTitle: 'Months',
    clear: 'Clear',
    weekStart: 1,
    format: 'dd/mm/yyyy'
  }

  // Set default weekStart based on company setting if available
  $(function() {
    // Check if company first day of week is available in the page
    if (typeof window.companyFirstDayOfWeek !== 'undefined') {
      $.fn.datepicker.defaults.weekStart = window.companyFirstDayOfWeek
    }
  })
})(jQuery)

$(function() {
  $('[data-toggle="tooltip"]').tooltip()
})

$(function() {
  // Initialize popovers except for leave summary triggers which are handled separately
  $('[data-toggle="popover"]:not(.leave-details-summary-trigger)').popover()
})

/*
 * This is handler for invocation of "add secondary supervisors" modal
 *
 * */

$('#add_secondary_supervisers_modal').on('show.bs.modal', function(event) {
  const button = $(event.relatedTarget)
  const department_name = button.data('department_name')
  const department_id = button.data('department_id')

  const modal = $(this)

  modal.find('.modal-title strong').text(department_name)

  // Make modal window to be no hiegher then window and its content
  // scrollable
  $('.modal .modal-body').css('overflow-y', 'auto')
  $('.modal .modal-body').css('max-height', $(window).height() * 0.7)

  $(this)
    .find('.modal-body')
    // Show "loading" icon while content of modal is loaded
    .html(
      '<p class="text-center"><i class="fa fa-refresh fa-spin fa-3x fa-fw"></i><span class="sr-only">Loading...</span></p>'
    )
    .load('/settings/departments/available-supervisors/' + department_id + '/')
})

/*
 *  Given URL string return its query paramters as object.
 *
 *  If URL is not provided location of current page is used.
 * */

function getUrlVars(url) {
  if (!url) {
    url = window.location.href
  }
  const vars = {}
  let hash
  const hashes = url.slice(url.indexOf('?') + 1).split('&')
  for (let i = 0; i < hashes.length; i++) {
    hash = hashes[i].split('=')
    vars[hash[0]] = hash[1]
  }
  return vars
}

/*
 * Evend that is fired when user change base date (current month) on Team View page.
 *
 * */

$(document).ready(function() {
  $('#team_view_month_select_btn')
    .datepicker()
    .on('changeDate', function(e) {
      const url = $(e.currentTarget).data('tom')

      const form = document.createElement('form')
      form.method = 'GET'
      form.action = url

      const url_params = getUrlVars(url)
      url_params.date = e.format('yyyy-mm')

      // Move query parameters into the form
      $.each(url_params, function(key, val) {
        const inp = document.createElement('input')
        inp.name = key
        inp.value = val
        inp.type = 'hidden'
        form.appendChild(inp)
      })

      document.body.appendChild(form)

      return form.submit()
    })
})

$(document).ready(function() {
  $('[data-tom-color-picker] a').on('click', function(e) {
    e.stopPropagation()

    // Close dropdown
    $(e.target)
      .closest('.dropdown-menu')
      .dropdown('toggle')

    const new_class_name = $(e.target).data('tom-color-picker-css-class')

    // Ensure newly selected color is on triggering element
    $(e.target)
      .closest('[data-tom-color-picker]')
      .find('button.dropdown-toggle')
      .attr('class', function(idx, c) {
        return c.replace(/leave_type_color_\d+/g, '')
      })
      .addClass(new_class_name)

    // Capture newly picked up color in hidden input for submission
    $(e.target)
      .closest('[data-tom-color-picker]')
      .find('input[type="hidden"]')
      .attr('value', new_class_name)

    return false
  })
})

$(document).ready(function() {
  const fetchNotifications = () => {
    if (typeof $.ajax === 'function') {
      $.ajax({
        url: '/api/v1/notifications/',
        success: function(args) {
          const error = args.error
          const data = args.data

          if (error) {
            console.log('Failed to fetch notifications')
            return
          }

          const dropDown = $('#header-notification-dropdown ul.dropdown-menu')
          const badge = $('#header-notification-dropdown .notification-badge')

          if (!data || !data.length) {
            badge.addClass('hidden')
            dropDown.empty()
            dropDown.append('<li class="dropdown-header">No notifications</li>')

            document.title = document.title.replace(/\(\d+\)\s*/, '')

            return
          }

          const numberOfNotifications = data
            .map(function(d) {
              return d.numberOfRequests
            })
            .reduce(function(acc, it) {
              return acc + it
            }, 0)

          badge.removeClass('hidden').html(numberOfNotifications)

          if (!document.title.startsWith('(')) {
            document.title = '(' + numberOfNotifications + ') ' + document.title
          } else {
            document.title = document.title.replace(
              /\(\d+\)/,
              '(' + numberOfNotifications + ')'
            )
          }

          dropDown.empty()

          for (let i = 0; i < data.length; i++) {
            const notification = data[i]
            dropDown.append(
              '<li><a href="' +
                notification.link +
                '">' +
                notification.label +
                '</a></li>'
            )
          }
        }
      })
    }

    setTimeout(fetchNotifications, 30 * 1000)
  }

  fetchNotifications()
})

$(document).ready(function() {
  var $banner = $('#cookie-consent-banner')
  if (!$banner.length) {
    return
  }

  var CONSENT_COOKIE = 'cookie_consent'
  var CONSENT_MAX_AGE_DAYS = 365
  var gaTracker = $banner.attr('data-ga-tracker') || ''

  function readConsentCookie() {
    var match = document.cookie.match(
      new RegExp('(?:^|; )' + CONSENT_COOKIE + '=([^;]*)')
    )
    return match ? decodeURIComponent(match[1]) : null
  }

  function writeConsentCookie(value) {
    var maxAge = CONSENT_MAX_AGE_DAYS * 24 * 60 * 60
    var secure = window.location.protocol === 'https:' ? '; Secure' : ''
    document.cookie =
      CONSENT_COOKIE +
      '=' +
      encodeURIComponent(value) +
      '; Path=/; Max-Age=' +
      maxAge +
      '; SameSite=Lax' +
      secure
  }

  function hideBanner() {
    $banner.addClass('cookie-consent-banner--hidden')
    $('body').removeClass('cookie-consent-banner-visible')
  }

  function showBanner() {
    $banner.removeClass('cookie-consent-banner--hidden')
    $('body').addClass('cookie-consent-banner-visible')
  }

  function loadGoogleAnalytics() {
    if (!gaTracker || window.ga) {
      return
    }

    ;(function(i, s, o, g, r, a, m) {
      i.GoogleAnalyticsObject = r
      i[r] =
        i[r] ||
        function() {
          ;(i[r].q = i[r].q || []).push(arguments)
        }
      i[r].l = 1 * new Date()
      a = s.createElement(o)
      m = s.getElementsByTagName(o)[0]
      a.async = 1
      a.src = g
      m.parentNode.insertBefore(a, m)
    })(
      window,
      document,
      'script',
      '//www.google-analytics.com/analytics.js',
      'ga'
    )

    window.ga('create', gaTracker, 'auto')
    window.ga('send', 'pageview')
  }

  function applyConsent(consent) {
    if (consent === 'all') {
      loadGoogleAnalytics()
    }
    hideBanner()
  }

  function saveConsent(consent) {
    writeConsentCookie(consent)
    applyConsent(consent)
  }

  $banner.on('click', '#cookie-consent-essential', function(e) {
    e.preventDefault()
    saveConsent('essential')
  })

  $banner.on('click', '#cookie-consent-all', function(e) {
    e.preventDefault()
    saveConsent('all')
  })

  $(document).on('click', '[data-cookie-settings]', function(e) {
    e.preventDefault()
    showBanner()
  })

  var existing = readConsentCookie()
  if (existing === 'essential' || existing === 'all') {
    applyConsent(existing)
  } else {
    showBanner()
  }
})
