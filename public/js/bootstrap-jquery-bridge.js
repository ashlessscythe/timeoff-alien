/**
 * jQuery compatibility layer for Bootstrap 5 components.
 * Allows existing jQuery .tooltip(), .popover(), .collapse() calls to work with BS5.
 */
;(function($) {
  if (typeof bootstrap === 'undefined') {
    return
  }

  function getOption(option, defaultValue) {
    if (option === undefined) {
      return defaultValue
    }
    return option
  }

  $.fn.tooltip = function(option) {
    return this.each(function() {
      const existing = bootstrap.Tooltip.getInstance(this)

      if (option === 'destroy') {
        if (existing) {
          existing.dispose()
        }
        return
      }

      if (option === 'hide') {
        if (existing) {
          existing.hide()
        }
        return
      }

      if (existing) {
        existing.dispose()
      }

      const config = typeof option === 'object' ? option : {}
      new bootstrap.Tooltip(this, config)
    })
  }

  $.fn.popover = function(option) {
    return this.each(function() {
      const existing = bootstrap.Popover.getInstance(this)

      if (option === 'destroy') {
        if (existing) {
          existing.dispose()
        }
        return
      }

      if (option === 'hide') {
        if (existing) {
          existing.hide()
        }
        return
      }

      if (option === 'toggle') {
        if (existing) {
          existing.toggle()
        }
        return
      }

      if (existing && typeof option === 'object') {
        existing.dispose()
      } else if (existing && !option) {
        return
      }

      const config = typeof option === 'object' ? option : {}
      if (config.html && config.sanitize === undefined) {
        config.sanitize = false
      }
      new bootstrap.Popover(this, config)
    })
  }

  $.fn.collapse = function(option) {
    return this.each(function() {
      let instance = bootstrap.Collapse.getInstance(this)

      if (!instance) {
        instance = new bootstrap.Collapse(this, { toggle: false })
      }

      if (option === 'show') {
        instance.show()
      } else if (option === 'hide') {
        instance.hide()
      } else if (option === 'toggle') {
        instance.toggle()
      }
    })
  }
})(jQuery)
