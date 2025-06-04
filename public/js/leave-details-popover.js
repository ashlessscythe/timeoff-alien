$(document).ready(function() {
  const LEAVE_TRIGGER_CLASS = 'leave-details-summary-trigger';

  // Completely remove any existing popover bindings
  $('.' + LEAVE_TRIGGER_CLASS).each(function() {
    const $element = $(this);
    // Remove all data and events
    $element.removeData();
    $element.off();
    // Remove any existing popover elements
    $('.popover').remove();
  });

  // Initialize leave details popover with click-only behavior
  $('.' + LEAVE_TRIGGER_CLASS).each(function() {
    const $element = $(this);

    $element.popover({
      title: 'Leave Summary',
      html: true,
      trigger: 'manual', // We'll handle the trigger ourselves
      placement: 'auto',
      container: 'body',
      content: function() {
        const leaveId = $element.data('leave-id');
        const divId = 'tmp-id-' + $.now();

        // Fetch leave summary via AJAX
        $.ajax({
          url: '/calendar/leave-summary/' + leaveId + '/',
          success: function(response) {
            $('#' + divId).html(response);
          },
          error: function(xhr, status, error) {
            $('#' + divId).html('Error loading leave summary');
          }
        });

        return '<div id="' + divId + '">Loading...</div>';
      }
    });

    // Handle click events manually
    $element.on('click', function(e) {
      e.preventDefault();
      e.stopPropagation();

      // Hide all other popovers
      $('.' + LEAVE_TRIGGER_CLASS).not(this).popover('hide');

      // Toggle this popover
      $element.popover('toggle');
    });
  });

  // Close popover when clicking outside
  $(document).on('click', function(e) {
    if (!$(e.target).closest('.popover').length &&
        !$(e.target).closest('.' + LEAVE_TRIGGER_CLASS).length) {
      $('.' + LEAVE_TRIGGER_CLASS).popover('hide');
    }
  });
});