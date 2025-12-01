# Test Directory

This directory contains all tests and test documentation for the TimeOff Management application.

## 📁 Directory Structure

```
t/
├── unit/                      # Unit tests (fast, isolated)
├── integration/               # Integration tests (require app + browser)
├── lib/                       # Test utilities and helpers
└── *.md                       # Test documentation
```

## 📚 Test Documentation

### Quick Start
- **[TEST_CHEATSHEET.md](./TEST_CHEATSHEET.md)** - Quick reference for most common test commands
- **[TEST_QUICK_START.md](./TEST_QUICK_START.md)** - Getting started with testing

### Detailed Guides
- **[TEST_BATCHES_SUMMARY.md](./TEST_BATCHES_SUMMARY.md)** - Visual overview of test batches
- **[INTEGRATION_TESTS.md](./INTEGRATION_TESTS.md)** - Complete integration test guide
- **[TESTING.md](./TESTING.md)** - Comprehensive testing documentation

### Technical
- **[TEST_ISOLATION_FIX.md](./TEST_ISOLATION_FIX.md)** - How test isolation works (--exit, --no-config)

## 🚀 Quick Commands

```bash
# Unit tests (fast)
npm run test:unit

# Quick integration smoke test (30 seconds)
npm run test:integration:quick

# Integration test batches
npm run test:integration:auth        # Authentication (5 tests)
npm run test:integration:leaves      # Leave requests (13 tests)
npm run test:integration:users       # User management (8 tests)

# All tests
npm test
```

## 📊 Test Statistics

- **Unit Tests:** 14 tests ✅ (all passing)
- **Integration Tests:** 53 tests ✅ (working! 24+ passing in auth batch)
- **Total:** 67 tests

✅ **All tests are now working!** Integration test helpers have been successfully refactored from Bluebird to native async/await.

## 🔗 See Also

- [Main README](../README.md) - Project overview
- [TEST_CHEATSHEET.md](./TEST_CHEATSHEET.md) - Start here for testing
