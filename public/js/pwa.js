// Register the service worker and surface an "Install app" prompt.
;(function() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function() {})
    })
  }

  var deferred = null
  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault()
    deferred = e
    var btns = document.querySelectorAll('[data-pwa-install]')
    Array.prototype.forEach.call(btns, function(b) {
      b.style.display = ''
    })
  })
  document.addEventListener('click', function(e) {
    var t = e.target.closest && e.target.closest('[data-pwa-install]')
    if (!t || !deferred) return
    e.preventDefault()
    deferred.prompt()
    deferred.userChoice.then(function() {
      deferred = null
      Array.prototype.forEach.call(document.querySelectorAll('[data-pwa-install]'), function(b) {
        b.style.display = 'none'
      })
    })
  })
  window.addEventListener('appinstalled', function() {
    deferred = null
  })
})()
