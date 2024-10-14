$(document).ready(function() {
  console.log('Popover initializer loaded')

  // User details popover
  $('.user-details-summary-trigger').popover({
    title: 'Employee summary',
    html: true,
    trigger: 'hover',
    placement: 'auto',
    delay: { show: 1000, hide: 10 },
    content: function() {
      console.log('User details popover triggered')
      var divId = 'tmp-id-' + $.now()
      return detailsInPopup(
        $(this).attr('data-user-id'),
        divId,
        '/users/summary/'
      )
    }
  })

  // Leave details popover
  $('.leave-details-summary-trigger').popover({
    title: 'Leave summary',
    html: true,
    trigger: 'hover',
    placement: 'auto',
    delay: { show: 1000, hide: 10 },
    content: function() {
      console.log('Leave details popover triggered')
      var leaveId = $(this).attr('data-leave-id')
      var divId = 'tmp-id-' + $.now()
      return detailsInPopup(leaveId, divId, '/calendar/leave-summary/')
    }
  })

  function detailsInPopup(id, divId, url) {
    console.log('Fetching details for ID:', id)

    $.ajax({
      url: url + id + '/',
      success: function(response) {
        console.log('Received response for ID:', id)
        $('#' + divId).html(response)
      },
      error: function(xhr, status, error) {
        console.error('Error fetching details:', error)
      }
    })

    return '<div id="' + divId + '">Loading...</div>'
  }

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

    // Make modal window to be no higher than window and its content scrollable
    $('.modal .modal-body').css('overflow-y', 'auto')
    $('.modal .modal-body').css('max-height', $(window).height() * 0.7)

    const url =
      '/settings/departments/available-supervisors/' + department_id + '/'
    console.log('Fetching supervisors from URL:', url)

    modal
      .find('.modal-body')
      .html(
        '<p class="text-center"><i class="fa fa-refresh fa-spin fa-3x fa-fw"></i><span class="sr-only">Loading...</span></p>'
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
