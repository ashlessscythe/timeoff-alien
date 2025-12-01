# Testing Guide

This document explains how to run tests for the TimeOff Management application.

## Test Structure

The project uses **Mocha** as the test framework and **Chai** for assertions. Tests are organized in the `t/` directory:

```
t/
├── unit/           # Unit tests (fast, no external dependencies)
├── integration/    # Integration tests (require running app + browser)
└── lib/            # Test utilities and helpers
```

## Test Types

### 1. Unit Tests

Unit tests are fast, isolated tests that don't require a running application or database.

**Run all unit tests:**
```bash
npm run test:unit
```

**Current unit test coverage:**
- Calendar month calculations
- Email template rendering
- Slack integration
- Turnstile verification
- Leave request validation
- User allowance calculations
- Database model logic

**Status:** ✅ All 14 unit tests passing

### 2. Integration Tests

Integration tests use Selenium WebDriver to test the full application flow in a browser. These tests:
- Require the application to be running on port 3000
- Use headless Chrome by default
- Test complete user workflows (registration, login, CRUD operations)

**Prerequisites:**
1. Application must be running: `npm run dev` or `npm start`
2. Chrome/Chromium must be installed
3. Database must be accessible

**Run integration tests:**
```bash
# Quick smoke test (3 tests, ~30 seconds)
npm run test:integration:quick

# Run by category (see INTEGRATION_TESTS.md for all batches)
npm run test:integration:auth        # Authentication tests
npm run test:integration:leaves      # Leave request tests
npm run test:integration:users       # User management tests

# All integration tests (53 tests, ~10-15 minutes)
npm run test:integration

# With visible browser
SHOW_BROWSER=1 npm run test:integration:quick

# Using Firefox instead
USE_FIREFOX=1 npm run test:integration:quick
```

**See [INTEGRATION_TESTS.md](./INTEGRATION_TESTS.md) for detailed batching guide.**

**Integration test coverage:**
- User registration and authentication
- CRUD operations for users, departments, leave types
- Leave request workflows
- Calendar functionality
- Permission and access control
- Carry-over allowance calculations

**Status:** ⚠️ Integration tests require running application server

### 3. Run All Tests

**Run all tests (unit + integration):**
```bash
npm test
```

**Note:** This will run all tests recursively from the `t/` directory. Make sure the application is running first for integration tests to pass.

## Test Configuration

### Environment Variables

Tests use `dotenv` to load environment variables from `.env` file:

```bash
# Required for integration tests
PORT=3000                    # Application port
DATABASE_URL=<your-db-url>   # Database connection

# Optional test configuration
USE_CHROME=1                 # Use Chrome (default)
USE_FIREFOX=1                # Use Firefox instead
SHOW_BROWSER=1               # Show browser window (for debugging)
```

### Test Timeout

Integration tests have a default timeout of 10 seconds per test. This is configured in `t/lib/config.js`.

### Test Isolation

All test commands use the following Mocha flags:
- `--exit` - Forces Mocha to exit after tests complete (prevents hanging)
- `--no-config` - Ignores any mocha configuration files (ensures clean execution)

This ensures each test batch runs independently without triggering additional tests.

## Running Specific Tests

**Run a specific test file:**
```bash
npm run test:file t/unit/calendar.js
npm run test:file t/integration/crud_users.js
```

**Run tests matching a pattern:**
```bash
npx mocha -r dotenv/config --grep "calendar" t/
```

## Debugging Tests

### View Browser During Tests
```bash
SHOW_BROWSER=1 npm run test:integration
```

### Run Single Test File
```bash
npm run test:file t/integration/crud_users.js
```

### Enable Mocha Reporter
```bash
npx mocha -r dotenv/config --reporter spec t/unit/
```

## CI/CD Integration

The project includes configuration for Travis CI (`.travis.yml`). Tests should be run in CI with:

```bash
# Install dependencies
npm ci

# Run linting
npm run lint

# Run unit tests (fast)
npm run test:unit

# Run integration tests (requires app + browser)
npm run test:integration
```

## Writing Tests

### Unit Test Example

```javascript
const expect = require('chai').expect

describe('My Feature', function() {
  it('should do something', function() {
    const result = myFunction()
    expect(result).to.equal(expectedValue)
  })
})
```

### Integration Test Example

```javascript
const test = require('selenium-webdriver/testing')
const By = require('selenium-webdriver').By
const expect = require('chai').expect
const config = require('../lib/config')

describe('My Integration Test', function() {
  this.timeout(config.get_execution_timeout())
  
  let driver
  
  it('should navigate and interact', function(done) {
    // Test implementation
  })
})
```

## Common Issues

### Integration Tests Timeout

**Problem:** Integration tests hang or timeout

**Solutions:**
1. Ensure application is running: `npm run dev`
2. Check database connection in `.env`
3. Verify Chrome/Chromium is installed
4. Check port 3000 is not blocked

### Database Connection Errors

**Problem:** Tests fail with database connection errors

**Solutions:**
1. Verify `DATABASE_URL` in `.env`
2. Ensure database is accessible
3. Run migrations: `npx prisma migrate deploy`
4. Check SSL settings for hosted databases

### Selenium WebDriver Errors

**Problem:** Browser driver not found

**Solutions:**
1. Install Chrome manually:
   ```bash
   wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
   sudo apt install -y ./google-chrome-stable_current_amd64.deb
   ```
2. Or install Chromium (may require snap in some environments)
3. Update selenium-webdriver: `npm install selenium-webdriver@latest`

**Note:** In containerized environments (Docker, Dev Containers), browser installation may require additional configuration. The devcontainer is configured to attempt Chromium installation on startup.

## Test Maintenance

### Adding New Tests

1. Create test file in appropriate directory (`t/unit/` or `t/integration/`)
2. Follow existing patterns and naming conventions
3. Use descriptive test names
4. Keep tests isolated and independent
5. Clean up resources (close drivers, etc.)

### Updating Tests

When modifying application code:
1. Run relevant tests: `npm run test:unit`
2. Update tests if behavior changes
3. Add new tests for new features
4. Ensure all tests pass before committing

## Performance Testing

A performance test script is available:

```bash
node test-performance.js
```

This tests application response times and database query performance.

## Summary

- **Unit tests:** Fast, isolated, always run these ✅
- **Integration tests:** Slower, require running app, test full workflows ⚠️
- **All tests:** Run before committing changes
- **CI/CD:** Automated testing on push/PR

For questions or issues, check the test files in `t/` directory for examples.
