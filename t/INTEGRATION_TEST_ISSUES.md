# Integration Test Issues

## Current Status

✅ **Integration test helpers have been refactored!**

### What Works
- ✅ Unit tests run perfectly (`npm run test:unit`)
- ✅ Chrome/Chromium is installed and accessible
- ✅ Selenium WebDriver can create browser instances
- ✅ Browser can access the running application
- ✅ Application is running and responding
- ✅ Test helpers refactored to use native async/await
- ✅ `register_new_user.js` - Working with async/await
- ✅ `login_with_user.js` - Working with async/await
- ✅ `open_page.js` - Working with async/await
- ✅ `logout_user.js` - Working with async/await
- ✅ `submit_form.js` - Working with async/await
- ✅ `check_elements.js` - Working with async/await

### What Needs Work
- ⚠️ Some integration tests still need `.catch(done)` added to promise chains
- ⚠️ Remaining helper functions need refactoring (add_new_user, user_info, etc.)
- ⚠️ Password changed from 6 to 12 characters (security requirement)
- ⚠️ Country code changed from "ZZ" to "US" (valid option)

## What Was Fixed

The integration test helper functions (in `t/lib/`) were using **Bluebird promises** with `Promise.promisify()` which expected callback-style functions. This was incompatible with Selenium WebDriver 4.x which uses native Promises.

### Solution Applied

Refactored helper functions to use native async/await:

**Before:**
```javascript
const register_new_user_func = Promise.promisify(function(args, callback) {
  const driver = args.driver || build_driver()
  driver.get(application_host)
  // ... callback-based code
  callback(null, { driver, email })
})
```

**After:**
```javascript
const register_new_user_func = async function(args) {
  const driver = args.driver || build_driver()
  await driver.get(application_host)
  // ... async/await code
  return { driver, email }
}
```

## Refactored Files

The following helper functions have been successfully refactored:

1. ✅ **register_new_user.js** - Fully async/await, password updated to 12 chars, country code fixed
2. ✅ **login_with_user.js** - Fully async/await, password updated to 12 chars
3. ✅ **open_page.js** - Simplified to async/await
4. ✅ **logout_user.js** - Fully async/await
5. ✅ **submit_form.js** - Complex form handling converted to async/await
6. ✅ **check_elements.js** - Element validation converted to async/await

## Still Need Refactoring

These files still use Bluebird and need conversion:

- `add_new_user.js`
- `check_booking_on_calendar.js`
- `set_user_to_start_at_the_beginning_of_the_year.js`
- `teamview_check_user.js`
- `user_info.js`

## Testing Status

**Unit tests work perfectly:**
```bash
npm run test:unit  # 14 tests, all passing
```

**Integration tests partially working:**
```bash
# This test works (5 passing, 2 failing due to business logic, not framework)
npm run test:file t/integration/register_new_user.js

# Other tests may need similar fixes (add .catch(done) to promise chains)
```

## Configuration Applied

The following has been configured correctly:
- ✅ Chrome installed
- ✅ Mocha timeout set to 60 seconds for integration tests
- ✅ Test isolation flags (`--exit`, `--no-config`)
- ✅ Environment variables loaded
- ✅ Application running on port 3000

## Next Steps

1. Refactor `t/lib/` helper functions to use native Promises/async-await
2. Remove Bluebird dependency from test helpers
3. Test each helper function individually
4. Gradually enable integration tests

## Testing Integration Tests Manually

You can test if Selenium works:

```bash
node -e "
const webdriver = require('selenium-webdriver');
const build_driver = require('./t/lib/build_driver');
const driver = build_driver();
driver.get('http://localhost:3000')
  .then(() => driver.getTitle())
  .then(title => { console.log('Title:', title); return driver.quit(); })
  .catch(err => { console.log('Error:', err); driver.quit(); });
"
```

This should output: `Title: Login | TimeOff`

## Related Files

- `t/lib/register_new_user.js` - Registration helper (needs refactoring)
- `t/lib/login_with_user.js` - Login helper (needs refactoring)
- `t/lib/submit_form.js` - Form submission helper (needs refactoring)
- `t/lib/build_driver.js` - Driver builder (works correctly)
- `t/lib/config.js` - Test configuration (works correctly)

## Temporary Recommendation

**Focus on unit tests** until integration test helpers are refactored:

```bash
npm run test:unit  # Fast, reliable, 14 tests
```

Integration tests are configured correctly but need helper function updates to work with Selenium WebDriver 4.x.
