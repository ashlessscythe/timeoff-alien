# Test Commands Cheat Sheet

## 🎯 Most Common Commands

```bash
# Fast unit tests (always run these first)
npm run test:unit

# Quick integration smoke test (30 seconds)
npm run test:integration:quick

# Run tests for what you're working on
npm run test:integration:leaves      # Working on leave requests
npm run test:integration:users       # Working on user management
npm run test:integration:auth        # Working on login/registration
```

## 📦 All Integration Test Batches

```bash
npm run test:integration:quick       # ⚡ 3 tests, ~30s - FASTEST
npm run test:integration:auth        # 🔐 5 tests, ~1-2m
npm run test:integration:users       # 👥 8 tests, ~2-3m
npm run test:integration:company     # 🏢 6 tests, ~1-2m
npm run test:integration:employees   # 📋 4 tests, ~1m
npm run test:integration:leaves      # 🏖️ 13 tests, ~3-4m - LARGEST
npm run test:integration:leave-types # 📝 6 tests, ~1-2m
npm run test:integration:schedule    # 📅 4 tests, ~1m
npm run test:integration:team        # 👁️ 4 tests, ~1m
npm run test:integration:carryover   # 🔄 2 tests, ~30s
npm run test:integration:api         # 🔌 2 tests, ~30s
npm run test:integration             # 🐌 53 tests, ~10-15m - FULL SUITE
```

## 🔍 Debug Commands

```bash
# Show browser window (see what's happening)
SHOW_BROWSER=1 npm run test:integration:quick

# Use Firefox instead of Chrome
USE_FIREFOX=1 npm run test:integration:auth

# Run single test file
npm run test:file t/integration/login_case_sensitive.js
npm run test:file t/unit/calendar.js
```

## ⚠️ Prerequisites for Integration Tests

```bash
# Terminal 1: Start the app FIRST
npm run dev

# Terminal 2: Then run integration tests
npm run test:integration:quick
```

## 🚦 Workflow

### During Development
```bash
npm run test:unit                    # Always fast
npm run test:integration:quick       # Quick check
npm run test:integration:leaves      # If working on leaves
```

### Before Commit
```bash
npm run test:unit
npm run test:integration:quick
```

### Before Merge/Release
```bash
npm run test:unit
npm run test:integration  # Full suite
```

## 📊 Test Counts

| Batch | Tests | Time |
|-------|-------|------|
| Unit | 14 | <1s |
| Quick | 3 | ~30s |
| Auth | 5 | ~1-2m |
| Users | 8 | ~2-3m |
| Leaves | 13 | ~3-4m |
| Company | 6 | ~1-2m |
| Leave Types | 6 | ~1-2m |
| Schedule | 4 | ~1m |
| Team | 4 | ~1m |
| Employees | 4 | ~1m |
| Carry Over | 2 | ~30s |
| API | 2 | ~30s |
| **Full Suite** | **53** | **~10-15m** |

## 💡 Pro Tips

1. **Always run unit tests first** - they're fast and catch most issues
2. **Use quick test for rapid feedback** - only 3 tests, 30 seconds
3. **Run relevant batch only** - don't run all 53 tests during development
4. **Full suite before merging** - ensure nothing broke
5. **Debug with SHOW_BROWSER=1** - see what the test is doing

## 🆘 Common Issues

**Tests hang?**
→ Make sure app is running: `npm run dev`

**Browser not found?**
→ Install Chrome: `wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && sudo apt install -y ./google-chrome-stable_current_amd64.deb`

**Database errors?**
→ Check `.env` file has correct `DATABASE_URL`

## 📚 Full Documentation

- [TEST_BATCHES_SUMMARY.md](./TEST_BATCHES_SUMMARY.md) - Detailed batch info
- [INTEGRATION_TESTS.md](./INTEGRATION_TESTS.md) - Complete integration guide
- [TESTING.md](./TESTING.md) - Full testing docs
- [TEST_ISOLATION_FIX.md](./TEST_ISOLATION_FIX.md) - How test isolation works
