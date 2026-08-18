document.addEventListener('DOMContentLoaded', function () {
  var form = document.getElementById('editLeaveForm')
  if (!form) {
    return
  }

  var editModal = document.getElementById('edit_leave_modal')
  var confirmModal = document.getElementById('confirm_edit_leave_modal')
  var reviewBtn = document.getElementById('editLeaveReviewBtn')
  var confirmSubmitBtn = document.getElementById('confirm_edit_submit_btn')
  var confirmBackBtn = document.getElementById('confirm_edit_back_btn')
  var leaveIdInput = document.getElementById('edit_leave_id')
  var employeeNameEl = document.getElementById('edit_employee_name')
  var leaveTypeSelect = document.getElementById('edit_leave_type')
  var incrementType = document.getElementById('edit_increment_type')
  var incrementValue = document.getElementById('edit_increment_value')
  var fromDate = document.getElementById('edit_from')
  var fromDatePart = document.getElementById('edit_from_date_part')
  var toDatePart = document.getElementById('edit_to_date_part')
  var timeStart = document.getElementById('edit_time_start')
  var timeEnd = document.getElementById('edit_time_end')
  var toDateHidden = document.getElementById('edit_to')
  var toDateMulti = document.getElementById('edit_to_date_multi')
  var multiDayGroup = document.getElementById('edit_multi_day_group')
  var reasonField = document.getElementById('edit_leave_reason')
  var nonDefaultHint = document.getElementById('edit_non_default_increment_hint')
  var warningDiv = document.getElementById('edit_next_year_pto_warning')
  var warningText = document.getElementById('edit_next_year_pto_warning_text')

  var defaultStartTime = '09:00:00'
  var MAX_PENDING_LEAVE_EDIT_SHIFT_DAYS = 14
  var allowedIncrementsByUser = {}
  var allowedNonDefaultByLeaveType = {}
  var allowedLeaveTypeIdsByUser = {}
  var isManagerOrAdmin =
    (form.getAttribute('data-is-manager-or-admin') || 'false') === 'true'
  var editUserId = null
  var originalSnapshot = null

  function parseJsonAttr(name, fallback) {
    try {
      var raw = form.getAttribute(name) || fallback
      return raw ? JSON.parse(raw) : JSON.parse(fallback)
    } catch (e) {
      return JSON.parse(fallback)
    }
  }

  allowedIncrementsByUser = parseJsonAttr('data-allowed-increments-by-user', '{}')
  allowedNonDefaultByLeaveType = parseJsonAttr(
    'data-allowed-non-default-increments-by-leave-type',
    '{}'
  )
  allowedLeaveTypeIdsByUser = parseJsonAttr(
    'data-allowed-leave-type-ids-by-user',
    '{}'
  )

  function getAllowedIncrementsForUser() {
    if (!editUserId) {
      return ['full_day', 'half_day']
    }
    return (
      allowedIncrementsByUser[String(editUserId)] || ['full_day', 'half_day']
    )
  }

  function getAllowedLeaveTypeIdsForUser() {
    if (!editUserId) {
      return null
    }
    return allowedLeaveTypeIdsByUser[String(editUserId)] || null
  }

  function filterLeaveTypeOptions() {
    var allowedIds = getAllowedLeaveTypeIdsForUser()
    Array.prototype.forEach.call(leaveTypeSelect.options, function (option) {
      if (!option.value) {
        return
      }
      var managerOnly = option.getAttribute('data-manager-only') === 'true'
      var allowedByDept =
        !allowedIds || allowedIds.indexOf(parseInt(option.value, 10)) !== -1
      var allowedByRole = !managerOnly || isManagerOrAdmin
      option.hidden = !(allowedByDept && allowedByRole)
      option.disabled = !(allowedByDept && allowedByRole)
    })
  }

  function updateIncrementTypeOptions() {
    var allowed = getAllowedIncrementsForUser()
    var leaveTypeId = leaveTypeSelect.value
    var leaveTypeAllowsNonDefault =
      allowedNonDefaultByLeaveType[String(leaveTypeId)] === true

    var types = []
    if (allowed.indexOf('full_day') !== -1) {
      types.push({ value: 'day', label: 'Full Day' })
    }
    if (allowed.indexOf('half_day') !== -1) {
      types.push({ value: 'halfday', label: 'Half Day' })
    }
    if (
      leaveTypeAllowsNonDefault &&
      allowed.indexOf('hourly') !== -1
    ) {
      types.push({ value: 'hr', label: 'Hours' })
    }
    if (
      leaveTypeAllowsNonDefault &&
      allowed.indexOf('quarter_hr') !== -1
    ) {
      types.push({ value: 'min', label: 'Minutes' })
    }

    if (types.length === 0) {
      types = [
        { value: 'day', label: 'Full Day' },
        { value: 'halfday', label: 'Half Day' }
      ]
    }

    var current = incrementType.value
    incrementType.innerHTML = ''
    types.forEach(function (item) {
      var option = document.createElement('option')
      option.value = item.value
      option.textContent = item.label
      if (item.value === current) {
        option.selected = true
      }
      incrementType.appendChild(option)
    })

    if (nonDefaultHint) {
      nonDefaultHint.style.display = leaveTypeAllowsNonDefault ? 'none' : 'block'
    }
  }

  function createOption(value, text, selected) {
    var option = document.createElement('option')
    option.value = value
    option.textContent = text
    if (selected) {
      option.selected = true
    }
    return option
  }

  function updateIncrementValueOptions(preferredValue) {
    var type = incrementType.value
    var currentValue = preferredValue || incrementValue.value
    incrementValue.innerHTML = ''

    if (type === 'day') {
      incrementValue.appendChild(createOption('1', 'All day', currentValue === '1'))
      if (multiDayGroup) {
        multiDayGroup.style.display = 'block'
      }
    } else {
      if (multiDayGroup) {
        multiDayGroup.style.display = 'none'
      }
      if (toDateMulti) {
        toDateMulti.value = ''
      }

      if (type === 'halfday') {
        incrementValue.appendChild(createOption('2', 'AM', currentValue === '2'))
        incrementValue.appendChild(createOption('3', 'PM', currentValue === '3'))
      } else if (type === 'hr') {
        for (var i = 1; i <= 8; i++) {
          incrementValue.appendChild(
            createOption(i.toString(), i + ' hour' + (i > 1 ? 's' : ''), currentValue === i.toString())
          )
        }
      } else if (type === 'min') {
        incrementValue.appendChild(createOption('15', '15 minutes', currentValue === '15'))
        incrementValue.appendChild(createOption('30', '30 minutes', currentValue === '30'))
      }
    }

    calculateTimes()
  }

  function calculateTimes() {
    var type = incrementType ? incrementType.value : 'day'
    var value = incrementValue ? incrementValue.value : '1'

    if (!fromDate || !fromDate.value) {
      return
    }

    var toDateValue = fromDate.value
    if (type === 'day' && toDateMulti && toDateMulti.value && toDateMulti.value.trim() !== '') {
      toDateValue = toDateMulti.value
    }

    if (!toDateValue || toDateValue.trim() === '') {
      toDateValue = fromDate.value
    }

    if (toDateHidden) {
      toDateHidden.value = toDateValue
    }

    if (type === 'day') {
      fromDatePart.value = '1'
      toDatePart.value = '1'
      timeStart.value = ''
      timeEnd.value = ''
    } else if (type === 'halfday') {
      fromDatePart.value = value
      toDatePart.value = '1'
      if (value === '2') {
        timeStart.value = defaultStartTime
        timeEnd.value = '13:00:00'
      } else {
        timeStart.value = '13:00:00'
        timeEnd.value = '17:00:00'
      }
    } else if (type === 'hr') {
      fromDatePart.value = '1'
      toDatePart.value = '1'
      var hours = parseInt(value, 10) || 1
      timeStart.value = defaultStartTime
      var endHour = 9 + hours
      timeEnd.value =
        (endHour < 10 ? '0' : '') + endHour + ':00:00'
    } else if (type === 'min') {
      fromDatePart.value = '1'
      toDatePart.value = '1'
      timeStart.value = defaultStartTime
      var mins = parseInt(value, 10) || 15
      var end = new Date('1970-01-01T09:00:00')
      end.setMinutes(end.getMinutes() + mins)
      timeEnd.value = end.toTimeString().slice(0, 8)
    }
  }

  function buildSnapshot() {
    return {
      type_name: leaveTypeSelect.options[leaveTypeSelect.selectedIndex].text,
      from_date: fromDate.value,
      to_date: toDateHidden.value || fromDate.value,
      increment_type: incrementType.value,
      increment_value: incrementValue.value,
      reason: reasonField.value || ''
    }
  }

  function parseDateOnly(value) {
    if (!value) {
      return null
    }
    var parsed = new Date(value)
    if (isNaN(parsed.getTime())) {
      return null
    }
    parsed.setHours(0, 0, 0, 0)
    return parsed
  }

  function isDateRangeWithinEditWindow(originalFrom, originalTo, nextFrom, nextTo) {
    var originalStart = parseDateOnly(originalFrom)
    var originalEnd = parseDateOnly(originalTo)
    var nextStart = parseDateOnly(nextFrom)
    var nextEnd = parseDateOnly(nextTo)
    if (!originalStart || !originalEnd || !nextStart || !nextEnd) {
      return false
    }
    var windowStart = new Date(originalStart)
    windowStart.setDate(windowStart.getDate() - MAX_PENDING_LEAVE_EDIT_SHIFT_DAYS)
    var windowEnd = new Date(originalEnd)
    windowEnd.setDate(windowEnd.getDate() + MAX_PENDING_LEAVE_EDIT_SHIFT_DAYS)
    return nextStart >= windowStart && nextEnd <= windowEnd
  }

  function openEditModal(leaveId) {
    fetch('/calendar/leave-edit/' + encodeURIComponent(leaveId) + '/')
      .then(function (response) {
        if (!response.ok) {
          throw new Error('Unable to load leave request')
        }
        return response.json()
      })
      .then(function (data) {
        editUserId = data.user_id
        leaveIdInput.value = data.leave_id
        employeeNameEl.textContent = data.employee_name
        leaveTypeSelect.value = String(data.leave_type_id)
        reasonField.value = data.reason || ''
        fromDate.value = data.from_date
        if (toDateMulti) {
          toDateMulti.value = data.show_multi_day ? data.to_date : ''
        }
        if (toDateHidden) {
          toDateHidden.value = data.to_date
        }

        filterLeaveTypeOptions()
        updateIncrementTypeOptions()
        incrementType.value = data.increment_type
        updateIncrementValueOptions(data.increment_value)
        calculateTimes()

        originalSnapshot = {
          type_name: data.type_name,
          from_date: data.from_date,
          to_date: data.to_date,
          deducted_days: data.deducted_days,
          reason: data.reason || ''
        }

        if (window.jQuery && editModal) {
          window.jQuery(editModal).modal('show')
        }
      })
      .catch(function (error) {
        alert(error.message || 'Failed to load leave request for editing.')
      })
  }

  document.addEventListener('click', function (event) {
    var trigger = event.target.closest('.edit-leave-btn')
    if (!trigger) {
      return
    }
    event.preventDefault()
    var leaveId = trigger.getAttribute('data-leave-id')
    if (leaveId) {
      openEditModal(leaveId)
    }
  })

  if (incrementType) {
    incrementType.addEventListener('change', function () {
      updateIncrementValueOptions()
    })
  }

  if (incrementValue) {
    incrementValue.addEventListener('change', calculateTimes)
  }

  if (fromDate) {
    fromDate.addEventListener('change', calculateTimes)
    fromDate.addEventListener('input', calculateTimes)
  }

  if (toDateMulti) {
    toDateMulti.addEventListener('change', calculateTimes)
  }

  if (leaveTypeSelect) {
    leaveTypeSelect.addEventListener('change', function () {
      updateIncrementTypeOptions()
      updateIncrementValueOptions()
    })
  }

  if (reviewBtn) {
    reviewBtn.addEventListener('click', function () {
      calculateTimes()

      if (!form.checkValidity()) {
        form.classList.add('was-validated')
        return
      }

      var after = buildSnapshot()
      var dateWindowOk = isDateRangeWithinEditWindow(
        originalSnapshot.from_date,
        originalSnapshot.to_date,
        after.from_date,
        after.to_date
      )
      if (!dateWindowOk) {
        alert(
          'Edited dates must stay within ' +
            MAX_PENDING_LEAVE_EDIT_SHIFT_DAYS +
            ' days of the original request. To book a different period, cancel this request and create a new one.'
        )
        return
      }

      document.getElementById('confirm_edit_before_type').textContent =
        originalSnapshot.type_name
      document.getElementById('confirm_edit_before_dates').textContent =
        formatDateRange(originalSnapshot)
      document.getElementById('confirm_edit_before_deducted').textContent =
        String(originalSnapshot.deducted_days)

      document.getElementById('confirm_edit_after_type').textContent =
        after.type_name
      document.getElementById('confirm_edit_after_dates').textContent =
        formatDateRange(after)
      document.getElementById('confirm_edit_after_deducted').textContent =
        'Recalculated on save'

      var noChangesEl = document.getElementById('confirm_edit_no_changes')
      var substantiveChanged =
        after.type_name !== originalSnapshot.type_name ||
        after.from_date !== originalSnapshot.from_date ||
        after.to_date !== originalSnapshot.to_date ||
        after.increment_type !== (originalSnapshot.increment_type || 'day')

      if (noChangesEl) {
        noChangesEl.style.display = substantiveChanged ? 'none' : 'block'
      }

      if (window.jQuery) {
        window.jQuery(editModal).modal('hide')
        window.jQuery(confirmModal).modal('show')
      }
    })
  }

  if (confirmBackBtn) {
    confirmBackBtn.addEventListener('click', function () {
      if (window.jQuery) {
        window.jQuery(confirmModal).modal('hide')
        window.jQuery(editModal).modal('show')
      }
    })
  }

  if (confirmSubmitBtn) {
    confirmSubmitBtn.addEventListener('click', function () {
      if (confirmSubmitBtn.disabled) {
        return
      }
      confirmSubmitBtn.disabled = true
      confirmSubmitBtn.textContent = 'Saving...'
      form.submit()
    })
  }
})
