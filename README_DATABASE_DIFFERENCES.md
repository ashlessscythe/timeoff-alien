# Database Differences: SQLite vs PostgreSQL with Prisma & Sequelize

## Quick Summary

Your TimeOff Management application uses **both Prisma and Sequelize** with **SQLite** as the current database. This document explains the key differences and how to work with both databases.

## Current Status ✅

- **Database**: SQLite (`file:../app.sqlite`)
- **Prisma**: Configured for SQLite
- **Sequelize**: Dynamically detects database type from `DATABASE_URL`
- **Seeding**: Working correctly (as demonstrated by successful seed run)

## Key Differences

### 1. **Data Types**

| Feature   | SQLite                | PostgreSQL                   |
| --------- | --------------------- | ---------------------------- |
| Boolean   | INTEGER (0/1)         | Native BOOLEAN               |
| Date/Time | TEXT/INTEGER          | DATE, TIMESTAMP, TIMESTAMPTZ |
| Enums     | TEXT with constraints | Native ENUM                  |
| Arrays    | Not supported         | Native ARRAY                 |
| JSON      | TEXT (with functions) | Native JSON/JSONB            |

### 2. **Performance**

| Aspect             | SQLite                  | PostgreSQL             |
| ------------------ | ----------------------- | ---------------------- |
| Concurrency        | Single-threaded         | Multi-threaded         |
| Architecture       | File-based              | Client-server          |
| Best for           | Development, small apps | Production, large apps |
| Connection Pooling | Not needed              | Essential              |

### 3. **Schema Support**

| Feature      | SQLite  | PostgreSQL             |
| ------------ | ------- | ---------------------- |
| Schemas      | No      | Yes (multiple schemas) |
| Foreign Keys | Limited | Full support           |
| Constraints  | Basic   | Advanced               |
| Indexes      | Basic   | Advanced               |

## Your Project Configuration

### Prisma (Current: SQLite)

```prisma
datasource db {
  provider = "sqlite"
  url      = "file:../app.sqlite"
}
```

### Sequelize (Dynamic Detection)

```javascript
// Automatically detects database type from DATABASE_URL
const isSQLite =
  databaseUrl.startsWith('file:') || databaseUrl.startsWith('sqlite:')
const isPostgreSQL =
  databaseUrl.startsWith('postgresql:') || databaseUrl.startsWith('postgres:')
```

## Testing Your Setup

### Run the Database Demo Script

```bash
# Test with SQLite (current)
node scripts/database-switch-example.js sqlite

# Test with PostgreSQL (if configured)
node scripts/database-switch-example.js postgresql
```

### Seed the Database

```bash
# Clear and seed with test data
node prisma/seed.mjs --clear
```

## Migration to PostgreSQL

If you want to switch to PostgreSQL:

### 1. Update Prisma Schema

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### 2. Set Environment Variable

```bash
export DATABASE_URL=postgresql://user:password@localhost:5432/timeoff_management
```

### 3. Run Migrations

```bash
npx prisma migrate dev --name init
npx prisma generate
```

## Files Created

1. **`DATABASE_COMPARISON.md`** - Detailed technical comparison
2. **`MIGRATION_GUIDE.md`** - Step-by-step migration instructions
3. **`scripts/database-switch-example.js`** - Demo script for both databases
4. **`README_DATABASE_DIFFERENCES.md`** - This summary

## Recommendations

### For Development

- ✅ **Keep SQLite** - Simple, fast, no setup required
- ✅ **Your current setup is perfect** for development

### For Production

- 🔄 **Consider PostgreSQL** - Better performance, concurrency, features
- 🔄 **Your Sequelize config already supports both** - Easy to switch

### For Your Project

- ✅ **Current setup works great** - No immediate changes needed
- 🔄 **Future consideration**: Migrate to PostgreSQL for production
- ✅ **Dual ORM approach** - Gives you flexibility

## Common Commands

```bash
# Seed database
node prisma/seed.mjs --clear

# Test database connections
node scripts/database-switch-example.js sqlite

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Deploy migrations (production)
npx prisma migrate deploy
```

## Troubleshooting

### SQLite Issues

- **Foreign keys**: Ensure `PRAGMA foreign_keys = ON`
- **Concurrent writes**: Consider PostgreSQL for multiple users
- **File permissions**: Check database file permissions

### PostgreSQL Issues

- **Connection**: Ensure PostgreSQL is running
- **Authentication**: Check user credentials
- **SSL**: Configure SSL for production

## Next Steps

1. **Continue development** with current SQLite setup
2. **Test the demo script** to understand differences
3. **Consider PostgreSQL** when ready for production
4. **Use the migration guide** when switching databases

Your application is well-architected to handle both databases seamlessly! 🎉
