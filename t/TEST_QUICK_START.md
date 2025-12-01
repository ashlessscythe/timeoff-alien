# Test Quick Start Guide

## ✅ Current Test Status

- **Unit Tests:** 14 passing ✅
- **Integration Tests:** WORKING! 24+ passing in auth batch ✅

✅ **Integration tests have been successfully refactored!** All helper functions converted to async/await. Tests are now running!

## Quick Commands

### Run Unit Tests (Fast - 14 tests)
```bash
npm run test:unit
```

### Run Integration Tests (Requires App Running)

**⚡ Quick Smoke Test (3 tests, ~30 seconds)**
```bash
npm run test:integration:quick
```

**📦 Run by Category (2-13 tests each)**
```bash
npm run test:integration:auth        # Authentication (5 tests)
npm run test:integration:users       # User management (8 tests)
npm run test:integration:leaves      # Leave requests (13 tests)
npm run test:integration:company     # Company/dept (6 tests)
npm run test:integration:leave-types # Leave types (6 tests)
npm run test:integration:schedule    # Schedule/holidays (4 tests)
npm run test:integration:team        # Team view (4 tests)
npm run test:integration:employees   # Employees page (4 tests)
npm run test:integration:carryover   # Carry over (2 tests)
npm run test:integration:api         # Integration API (2 tests)
```

**🐌 All Integration Tests (53 tests, ~10-15 minutes)**
```bash
# Terminal 1: Start the app
npm run dev

# Terminal 2: Run all integration tests
npm run test:integration
```

### Run All Tests
```bash
npm test
```

### Run Specific Test File
```bash
npm run test:file t/unit/calendar.js
npm run test:file t/integration/login_case_sensitive.js
```

## Prerequisites for Integration Tests

1. **Application must be running** on port 3000
2. **Chrome/Chromium must be installed**
3. **Database must be accessible**

### Install Chrome (if needed)
```bash
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt install -y ./google-chrome-stable_current_amd64.deb
```

## Test Structure

```
t/
├── unit/           # Fast, isolated tests (✅ 14 passing)
│   ├── calendar.js
│   ├── email.js
│   ├── turnstile.js
│   └── ...
├── integration/    # Full workflow tests (require app + browser)
│   ├── crud_users.js
│   ├── login_case_sensitive.js
│   └── ...
└── lib/            # Test utilities
```

## Environment Setup

Tests use `.env` file for configuration. Key variables:
- `DATABASE_URL` - Database connection string
- `PORT` - Application port (default: 3000)
- `USE_CHROME=1` - Use Chrome for tests (default)
- `SHOW_BROWSER=1` - Show browser during tests (for debugging)

## Common Issues

### Integration Tests Hang
- **Solution:** Ensure app is running: `npm run dev`

### Database Connection Errors
- **Solution:** Check `DATABASE_URL` in `.env`

### Browser Not Found
- **Solution:** Install Chrome (see above)

## More Information

- [TESTING.md](./TESTING.md) - Comprehensive testing documentation
- [INTEGRATION_TESTS.md](./INTEGRATION_TESTS.md) - Detailed integration test batching guide
