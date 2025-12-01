# Integration Test Batches - Quick Reference

## 🚀 Start Here

**Before running integration tests:**
```bash
# Terminal 1: Start the app
npm run dev
```

## ⚡ Quick Commands

| Command | Tests | Time | Use Case |
|---------|-------|------|----------|
| `npm run test:integration:quick` | 3 | ~30s | Smoke test, rapid feedback |
| `npm run test:integration:auth` | 5 | ~1-2m | Login/registration changes |
| `npm run test:integration:users` | 8 | ~2-3m | User management changes |
| `npm run test:integration:leaves` | 13 | ~3-4m | Leave request changes |
| `npm run test:integration:company` | 6 | ~1-2m | Company/dept changes |
| `npm run test:integration:leave-types` | 6 | ~1-2m | Leave type changes |
| `npm run test:integration:schedule` | 4 | ~1m | Schedule/holiday changes |
| `npm run test:integration:team` | 4 | ~1m | Team view changes |
| `npm run test:integration:employees` | 4 | ~1m | Employee page changes |
| `npm run test:integration:carryover` | 2 | ~30s | Carry over logic |
| `npm run test:integration:api` | 2 | ~30s | API integration |
| `npm run test:integration` | 53 | ~10-15m | Full test suite |

## 📊 Test Distribution

```
Total: 53 integration tests

Leave Requests    ████████████████ 13 tests (25%)
Users             ████████ 8 tests (15%)
Leave Types       ██████ 6 tests (11%)
Company/Dept      ██████ 6 tests (11%)
Auth              █████ 5 tests (9%)
Employees         ████ 4 tests (8%)
Schedule          ████ 4 tests (8%)
Team View         ████ 4 tests (8%)
Carry Over        ██ 2 tests (4%)
API               ██ 2 tests (4%)
```

## 🎯 Recommended Workflow

### During Active Development
```bash
# 1. Unit tests (always fast)
npm run test:unit

# 2. Relevant batch only
npm run test:integration:leaves  # if working on leave requests

# 3. Quick smoke test
npm run test:integration:quick
```

### Before Committing
```bash
npm run test:unit
npm run test:integration:quick
# + relevant batches for changed areas
```

### Before Merging/Releasing
```bash
npm run test:unit
npm run test:integration  # Full suite
```

## 🔍 Debug Mode

```bash
# Show browser window
SHOW_BROWSER=1 npm run test:integration:quick

# Use Firefox
USE_FIREFOX=1 npm run test:integration:auth

# Run single test
npm run test:file t/integration/login_case_sensitive.js
```

## 📝 What Each Batch Tests

### 🔐 Auth (5 tests)
- Login case sensitivity
- User registration
- Duplicate email handling
- Guest access control

### 👥 Users (8 tests)
- Create, read, update, delete users
- Email validation
- Activate/deactivate
- Import users
- Admin rights management

### 🏖️ Leaves (13 tests) - LARGEST BATCH
- Request, approve, cancel leaves
- Auto-approve functionality
- Overlapping bookings
- Half-day leaves
- Allowance limits
- Multi-year leaves

### 🏢 Company (6 tests)
- Company settings
- Department management
- Timezone handling
- Account deletion

### 📝 Leave Types (6 tests)
- CRUD leave types
- Auto-approve settings
- Usage limits
- Calendar coloring

### 📅 Schedule (4 tests)
- Company-wide schedules
- User-specific schedules
- Bank holidays
- Date formats

### 👁️ Team (4 tests)
- Wall chart view
- Deducted columns
- Cross-links

### 📋 Employees (4 tests)
- Employee listing
- Filtering
- Calendar views
- Column calculations

### 🔄 Carry Over (2 tests)
- New user handling
- Negative allowance

### 🔌 API (2 tests)
- Audit logs
- Enable/disable API

## 💡 Tips

1. **Start small:** Use `test:integration:quick` for rapid feedback
2. **Focus testing:** Only run batches related to your changes
3. **Full suite:** Run before major commits or releases
4. **Parallel CI:** Run batches in parallel in CI/CD for faster results
5. **Debug mode:** Use `SHOW_BROWSER=1` when tests fail to see what's happening

## 📚 More Details

- [INTEGRATION_TESTS.md](./INTEGRATION_TESTS.md) - Complete integration test guide
- [TESTING.md](./TESTING.md) - Full testing documentation
- [TEST_QUICK_START.md](./TEST_QUICK_START.md) - Quick start guide
