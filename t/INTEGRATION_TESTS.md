# Integration Tests - Batched Execution Guide

## Overview

The project has **53 integration tests** that test complete user workflows using Selenium WebDriver. Running all tests takes a long time, so they've been organized into **batches** for faster, focused testing.

**Important:** All batch commands use `--exit` and `--no-config` flags to ensure:
- Tests stop immediately after completion (no hanging processes)
- No hidden mocha configuration files interfere with test execution
- Each batch runs independently without triggering other tests

## Prerequisites

⚠️ **Integration tests require:**
1. Application running on port 3000: `npm run dev`
2. Chrome/Chromium installed
3. Database accessible (configured in `.env`)

## Quick Start

### Fastest Tests (3 tests, ~30 seconds)
```bash
npm run test:integration:quick
```
Tests: login, registration, basic CRUD

### Run All Integration Tests (~10-15 minutes)
```bash
npm run test:integration
```

## Test Batches

### 🔐 Authentication & Registration (5 tests)
```bash
npm run test:integration:auth
```
**Tests:**
- Login case sensitivity
- New user registration
- Register with existing email
- Register while logged in
- Guest access to private pages

**Time:** ~1-2 minutes

---

### 👥 User Management (8 tests)
```bash
npm run test:integration:users
```
**Tests:**
- CRUD operations for users
- Add user with existing email
- Edit user with duplicate email
- Activate/deactivate users
- Inactivate users
- User import
- Edit user dates
- Revoke admin rights

**Time:** ~2-3 minutes

---

### 🏢 Company & Department (6 tests)
```bash
npm run test:integration:company
```
**Tests:**
- Edit company details
- Delete account
- Department CRUD
- Menu bar user reflection
- Timezone handling

**Time:** ~1-2 minutes

---

### 📋 Employees Page (4 tests)
```bash
npm run test:integration:employees
```
**Tests:**
- Filter users by departments
- Remaining/used columns match user details
- Admin view of user calendar

**Time:** ~1 minute

---

### 🏖️ Leave Requests (13 tests)
```bash
npm run test:integration:leaves
```
**Tests:**
- Basic leave request
- Auto-approve leaves
- Cancel leave requests
- Leave request revoke (user & admin)
- Create leave with single user
- Leave in next year
- Overlapping bookings (full & half days)
- Rendering of half days
- Request leaves for other users
- Try to overbook allowance
- User auto-approve
- Book leave request form

**Time:** ~3-4 minutes

---

### 📝 Leave Types (6 tests)
```bash
npm run test:integration:leave-types
```
**Tests:**
- CRUD leave types
- Leave type auto-approve
- Leave type limits (current & next year)
- Remove used leave type
- Coloring on calendar

**Time:** ~1-2 minutes

---

### 📅 Schedule & Bank Holidays (4 tests)
```bash
npm run test:integration:schedule
```
**Tests:**
- Company-wide schedule
- User-specific schedule
- CRUD bank holidays
- Non-default date format for bank holidays

**Time:** ~1 minute

---

### 👁️ Team View (4 tests)
```bash
npm run test:integration:team
```
**Tests:**
- Basic wall chart
- Deducted column
- Deducted column visibility
- Team view cross-links

**Time:** ~1 minute

---

### 🔄 Carry Over (2 tests)
```bash
npm run test:integration:carryover
```
**Tests:**
- Just added users
- Negative when switched off

**Time:** ~30 seconds

---

### 🔌 Integration API (2 tests)
```bash
npm run test:integration:api
```
**Tests:**
- Audit functionality
- Enable/disable API

**Time:** ~30 seconds

---

## Running Specific Tests

### Single Test File
```bash
npm run test:file t/integration/login_case_sensitive.js
```

### Multiple Specific Files
```bash
npx mocha -r dotenv/config t/integration/login_case_sensitive.js t/integration/register_new_user.js
```

### Pattern Matching
```bash
npx mocha -r dotenv/config --grep "leave request" t/integration/
```

## Debugging Integration Tests

### Show Browser Window
```bash
SHOW_BROWSER=1 npm run test:integration:auth
```

### Use Firefox Instead of Chrome
```bash
USE_FIREFOX=1 npm run test:integration:auth
```

### Increase Timeout
Edit `t/lib/config.js` and modify `get_execution_timeout()`:
```javascript
get_execution_timeout: function() {
  return 30 * 1000  // 30 seconds instead of 10
}
```

## Test Organization

```
t/integration/
├── Authentication (5 tests)
│   ├── login_case_sensitive.js
│   ├── register_new_user.js
│   ├── register_new_company_for_existing_email.js
│   ├── try_to_register_with_loggedon_user.js
│   └── try_to_open_private_pages_with_guest.js
│
├── Users (8 tests)
│   ├── crud_users.js
│   ├── add_new_user_with_existing_email.js
│   ├── edit_user_to_have_duplicated_email.js
│   ├── deactivate_and_activate_user.js
│   ├── inactivate_user.js
│   ├── users_import.js
│   ├── user_edit_non_default_dates.js
│   └── try_to_revoke_admin_rights_from_last_admin.js
│
├── company/ (2 tests)
│   ├── delete_account.js
│   └── edit_company_details.js
│
├── department/ (1 test)
│   └── one_by_one_crud.js
│
├── employees_page/ (2 tests)
│   ├── filter_users_by_departments.js
│   └── remaining_used_columns_match_user_details.js
│
├── employee_details_section/ (1 test)
│   └── admin_view_of_user_calendar.js
│
├── leave_request/ (13 tests)
│   ├── auto_approve.js
│   ├── basic_leave_request.js
│   ├── book_leave_request_form.js
│   ├── cancel_basic.js
│   ├── create_leave_with_single_user.js
│   ├── leave_in_next_year.js
│   ├── leave_request_revoke.js
│   ├── leave_request_revoke_by_admin.js
│   ├── ovelapping_bookings.js
│   ├── ovelapping_bookings_halfs.js
│   ├── rendering_of_halves.js
│   ├── request_leaves_for_other_users.js
│   ├── try_to_overbook_allowance.js
│   └── user_auto_approve.js
│
├── leave_type/ (6 tests)
│   ├── colouring_on_calendar.js
│   ├── crud_leave_type.js
│   ├── leave_type_auto_approve.js
│   ├── leave_type_limit_in_action.js
│   ├── leave_type_limit_next_year.js
│   └── remove_used_leave_type.js
│
├── schedule/ (2 tests)
│   ├── company_wide.js
│   └── user_specific.js
│
├── bank_holidays/ (2 tests)
│   ├── crud_bank_holiday.js
│   └── non_default_date_format.js
│
├── team_view/ (4 tests)
│   ├── basic_wall_chart.js
│   ├── deducted_column.js
│   ├── deducted_column__visibility.js
│   └── teamview_cross_links.js
│
├── carryOver/ (2 tests)
│   ├── justAddedUsers.js
│   └── negativeWhenSwitchedOff.js
│
└── integration_api/ (2 tests)
    ├── audit.js
    └── enable_disable.js
```

## Recommended Testing Workflow

### During Development
1. Run unit tests first (fast): `npm run test:unit`
2. Run relevant integration batch: `npm run test:integration:leaves`
3. Run quick smoke test: `npm run test:integration:quick`

### Before Committing
1. Run unit tests: `npm run test:unit`
2. Run affected integration batches
3. Consider running all integration tests if time permits

### CI/CD Pipeline
```bash
# Fast feedback
npm run test:unit

# Parallel batches (if CI supports it)
npm run test:integration:auth &
npm run test:integration:users &
npm run test:integration:leaves &
wait

# Or sequential
npm run test:integration
```

## Performance Tips

1. **Use batches** instead of running all tests
2. **Run headless** (default) - don't use `SHOW_BROWSER=1` in CI
3. **Parallelize** batches in CI/CD if possible
4. **Focus on changed areas** - only run relevant batches during development
5. **Use quick tests** for rapid feedback during development

## Common Issues

### Tests Timeout
- Increase timeout in `t/lib/config.js`
- Check if app is running: `npm run dev`
- Verify database connection

### Browser Crashes
- Ensure Chrome is installed: `google-chrome --version`
- Try Firefox: `USE_FIREFOX=1 npm run test:integration:auth`
- Check available memory

### Flaky Tests
- Run specific test multiple times: `npm run test:file <path>`
- Check for timing issues in test code
- Verify database state between tests

## Summary

- **53 total integration tests** organized into **10 batches**
- **Quick test** (3 tests) for rapid feedback
- **Batch tests** (2-13 tests each) for focused testing
- **Full suite** when you have time

**Recommended:** Use batches during development, run full suite before major commits.
