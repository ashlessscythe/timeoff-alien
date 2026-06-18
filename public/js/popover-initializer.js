$(document).ready(function() {
  console.log('Popover initializer loaded')

  const userSummaryCache = {}
  const USER_TRIGGER = '.user-details-summary-trigger:not(.leave-details-summary-trigger)'

  function readUserId($element) {
    const fromSelf =
      $element.attr('data-user-id') ||
      $element.data('userId') ||
      $element.data('user-id')
    if (fromSelf) return String(fromSelf)

    const $row = $element.closest('[data-vpp-user-list-row]')
    if ($row.length) {
      const fromRow =
        $row.attr('data-vpp-user-list-row') || $row.data('vppUserListRow')
      if (fromRow) return String(fromRow)
    }

    return null
  }

  function detailsInPopup(id, divId, url) {
    if (!id) {
      return '<div class="text-danger">Could not load employee summary.</div>'
    }

    if (userSummaryCache[id]) {
      setTimeout(function() {
        $('#' + divId).html(userSummaryCache[id])
      }, 0)
      return '<div id="' + divId + '">' + userSummaryCache[id] + '</div>'
    }

    $.ajax({
      url: url + id + '/',
      success: function(response) {
        userSummaryCache[id] = response
        $('#' + divId).html(response)
      },
      error: function(_xhr, _status, error) {
        console.error('Error fetching user summary:', error)
        $('#' + divId).html(
          '<div class="text-danger">Failed to load employee summary.</div>'
        )
      }
    })

    return '<div id="' + divId + '">Loading...</div>'
  }

  // Bind per element so user id is captured in closure (BS5 popover content callbacks
  // do not receive the trigger element as `this`).
  $(USER_TRIGGER).each(function() {
    const $element = $(this)
    const userId = readUserId($element)

    $element.popover({
      title: 'Employee summary',
      html: true,
      trigger: 'hover',
      placement: 'auto',
      delay: { show: 1000, hide: 10 },
      sanitize: false,
      content: function() {
        const divId = 'tmp-id-' + $.now()
        return detailsInPopup(userId, divId, '/users/summary/')
      }
    })
  })

  // Add secondary supervisors modal
  $('#add_secondary_supervisers_modal').on('show.bs.modal', function(event) {
    console.log('Add secondary supervisors modal triggered')
    const button = $(event.relatedTarget)
    const department_name = button.data('department_name')
    const department_id = button.data('department_id')

    console.log('Department Name:', department_name)
    console.log('Department ID:', department_id)

    const modal = $(this)

    modal.find('.modal-title strong').text(department_name)

    $('.modal .modal-body').css('overflow-y', 'auto')
    $('.modal .modal-body').css('max-height', $(window).height() * 0.7)

    const url =
      '/settings/departments/available-supervisors/' + department_id + '/'
    console.log('Fetching supervisors from URL:', url)

    modal
      .find('.modal-body')
      .html(
        '<p class="text-center"><i class="fa fa-refresh fa-spin fa-3x fa-fw"></i><span class="visually-hidden">Loading...</span></p>'
      )
      .load(url, function(response, status, xhr) {
        if (status == 'error') {
          console.error(
            'Error loading supervisors:',
            xhr.status,
            xhr.statusText
          )
          modal
            .find('.modal-body')
            .html(
              '<p class="text-center text-danger">Error loading supervisors. Please try again.</p>'
            )
        } else {
          console.log('Supervisors loaded successfully')
        }
      })
  })
})
