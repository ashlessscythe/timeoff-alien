(function () {
  'use strict'

  var CONSENT_COOKIE = 'cookie_consent'
  var CONSENT_MAX_AGE_DAYS = 365

  var banner = document.getElementById('cookie-consent-banner')
  if (!banner) {
    return
  }

  var gaTracker = banner.getAttribute('data-ga-tracker')

  function readConsentCookie() {
    var match = document.cookie.match(
      new RegExp('(?:^|; )' + CONSENT_COOKIE + '=([^;]*)')
    )
    if (!match) {
      return null
    }
    return decodeURIComponent(match[1])
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
    banner.classList.add('cookie-consent-banner--hidden')
    document.body.classList.remove('cookie-consent-banner-visible')
  }

  function showBanner() {
    banner.classList.remove('cookie-consent-banner--hidden')
    document.body.classList.add('cookie-consent-banner-visible')
  }

  function loadGoogleAnalytics() {
    if (!gaTracker || window.ga) {
      return
    }

    ;(function (i, s, o, g, r, a, m) {
      i.GoogleAnalyticsObject = r
      i[r] =
        i[r] ||
        function () {
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

  var existing = readConsentCookie()
  if (existing === 'essential' || existing === 'all') {
    applyConsent(existing)
  } else {
    showBanner()
  }

  var essentialBtn = document.getElementById('cookie-consent-essential')
  var allBtn = document.getElementById('cookie-consent-all')

  if (essentialBtn) {
    essentialBtn.addEventListener('click', function () {
      saveConsent('essential')
    })
  }

  if (allBtn) {
    allBtn.addEventListener('click', function () {
      saveConsent('all')
    })
  }

  document.addEventListener('click', function (event) {
    var trigger = event.target.closest('[data-cookie-settings]')
    if (!trigger) {
      return
    }
    event.preventDefault()
    showBanner()
  })
})()
