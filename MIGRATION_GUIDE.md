# Database Migration Guide: SQLite to PostgreSQL

## Overview

This guide walks you through migrating the TimeOff Management application from SQLite to PostgreSQL while maintaining compatibility with both Prisma and Sequelize.

## Prerequisites

1. PostgreSQL server installed and running
2. Database created for the application
3. User with appropriate permissions

## Step 1: Environment Setup

### 1.1 Install PostgreSQL (if not already installed)

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install postgresql postgresql-contrib

# macOS (with Homebrew)
brew install postgresql
brew services start postgresql

# Windows
# Download from https://www.postgresql.org/download/windows/
```

### 1.2 Create Database and User

```sql
-- Connect to PostgreSQL as superuser
sudo -u postgres psql

-- Create database
CREATE DATABASE timeoff_management;

-- Create user
CREATE USER timeoff_user WITH PASSWORD 'your_secure_password';

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE timeoff_management TO timeoff_user;

-- Connect to the database and grant schema permissions
\c timeoff_management
GRANT ALL ON SCHEMA public TO timeoff_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO timeoff_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO timeoff_user;

-- Exit
\q
```

### 1.3 Set Environment Variables

Create a `.env` file or update your existing one:

```bash
# For PostgreSQL
DATABASE_URL=postgresql://timeoff_user:your_secure_password@localhost:5432/timeoff_management

# Optional: SSL configuration for production
USE_SSL=true
DB_SSL_REQUIRE=true
DB_SSL_REJECT_UNAUTHORIZED=false

# Database connection pooling
DB_POOL_MAX=10
DB_POOL_MIN=2
DB_POOL_ACQUIRE=60000
DB_POOL_IDLE=10000
```

## Step 2: Update Prisma Configuration

### 2.1 Update Prisma Schema

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ... rest of your models remain the same
```

### 2.2 Generate Prisma Client

```bash
npx prisma generate
```

## Step 3: Data Migration

### 3.1 Export Data from SQLite

Create a data export script:

```javascript
// scripts/export-sqlite-data.js
const { PrismaClient } = require('@prisma/client')
const fs = require('fs')

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'file:./app.sqlite' // Your current SQLite database
    }
  }
})

async function exportData() {
  try {
    const data = {
      companies: await prisma.companies.findMany(),
      departments: await prisma.departments.findMany(),
      users: await prisma.users.findMany(),
      leave_types: await prisma.leave_types.findMany(),
      leaves: await prisma.leaves.findMany(),
      schedules: await prisma.schedules.findMany(),
      bank_holidays: await prisma.bank_holidays.findMany()
      // Add other tables as needed
    }

    fs.writeFileSync('data-export.json', JSON.stringify(data, null, 2))
    console.log('✅ Data exported successfully')
  } catch (error) {
    console.error('❌ Export failed:', error)
  } finally {
    await prisma.$disconnect()
  }
}

exportData()
```

### 3.2 Run Data Export

```bash
node scripts/export-sqlite-data.js
```

### 3.3 Import Data to PostgreSQL

```javascript
// scripts/import-postgresql-data.js
const { PrismaClient } = require('@prisma/client')
const fs = require('fs')

const prisma = new PrismaClient() // Uses DATABASE_URL from .env

async function importData() {
  try {
    const data = JSON.parse(fs.readFileSync('data-export.json', 'utf8'))

    // Import in correct order (respecting foreign keys)
    for (const company of data.companies) {
      await prisma.companies.create({ data: company })
    }

    for (const department of data.departments) {
      await prisma.departments.create({ data: department })
    }

    for (const user of data.users) {
      await prisma.users.create({ data: user })
    }

    // Continue with other tables...

    console.log('✅ Data imported successfully')
  } catch (error) {
    console.error('❌ Import failed:', error)
  } finally {
    await prisma.$disconnect()
  }
}

importData()
```

## Step 4: Run Migrations

### 4.1 Create Initial Migration

```bash
npx prisma migrate dev --name init
```

### 4.2 Deploy Migrations

```bash
npx prisma migrate deploy
```

## Step 5: Update Application Code

### 5.1 Update Database Connection Logic

Your existing code in `lib/model/db/index.js` already handles both databases dynamically, so no changes needed there.

### 5.2 Test Database Switching

```bash
# Test with SQLite
DATABASE_URL=file:./app.sqlite node scripts/database-switch-example.js sqlite

# Test with PostgreSQL
DATABASE_URL=postgresql://timeoff_user:password@localhost:5432/timeoff_management node scripts/database-switch-example.js postgresql
```

## Step 6: Update Data Types (Optional)

### 6.1 Convert Boolean Fields

PostgreSQL supports native boolean types. Update your Prisma schema:

```prisma
model users {
  // Change from Int to Boolean for better type safety
  activated Boolean @default(false)
  admin     Boolean @default(false)
  manager   Boolean @default(false)
  // ... other fields
}
```

### 6.2 Add Enum Types

```prisma
enum LeaveStatus {
  PENDING
  APPROVED
  REJECTED
}

model leaves {
  status LeaveStatus
  // ... other fields
}
```

### 6.3 Use Timestamp with Timezone

```prisma
model users {
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt
  // ... other fields
}
```

## Step 7: Production Deployment

### 7.1 Environment Variables for Production

```bash
# Production environment
DATABASE_URL=postgresql://username:password@your-db-host:5432/timeoff_management
USE_SSL=true
DB_SSL_REQUIRE=true
DB_SSL_REJECT_UNAUTHORIZED=true
DB_POOL_MAX=20
DB_POOL_MIN=5
```

### 7.2 SSL Configuration

For production, ensure SSL is properly configured:

```javascript
// In your database configuration
if (isPostgreSQL && process.env.NODE_ENV === 'production') {
  databaseConfig.dialectOptions.ssl = {
    require: true,
    rejectUnauthorized: true
  }
}
```

## Step 8: Testing

### 8.1 Run Test Suite

```bash
# Test with PostgreSQL
DATABASE_URL=postgresql://timeoff_user:password@localhost:5432/timeoff_management npm test
```

### 8.2 Performance Testing

```bash
# Run performance tests
node scripts/performance-test.js
```

## Step 9: Rollback Plan

### 9.1 Keep SQLite Backup

```bash
# Backup your SQLite database
cp app.sqlite app.sqlite.backup
```

### 9.2 Rollback Script

```bash
# If issues occur, quickly switch back to SQLite
export DATABASE_URL=file:./app.sqlite
npx prisma generate
npm start
```

## Common Issues and Solutions

### Issue 1: Connection Refused

**Error**: `ECONNREFUSED`

**Solution**: Ensure PostgreSQL is running and accessible:

```bash
sudo systemctl status postgresql
sudo systemctl start postgresql
```

### Issue 2: Authentication Failed

**Error**: `password authentication failed`

**Solution**: Check user credentials and permissions:

```sql
-- Reset password
ALTER USER timeoff_user WITH PASSWORD 'new_password';
```

### Issue 3: Schema Not Found

**Error**: `schema "public" does not exist`

**Solution**: Create the schema:

```sql
CREATE SCHEMA IF NOT EXISTS public;
GRANT ALL ON SCHEMA public TO timeoff_user;
```

### Issue 4: Data Type Mismatches

**Error**: `invalid input syntax for type boolean`

**Solution**: Update data migration script to handle type conversions:

```javascript
// Convert SQLite integers to PostgreSQL booleans
const user = {
  ...sqliteUser,
  activated: Boolean(sqliteUser.activated),
  admin: Boolean(sqliteUser.admin),
  manager: Boolean(sqliteUser.manager)
}
```

## Performance Optimization

### 1. Connection Pooling

```javascript
// Optimize connection pool for PostgreSQL
const databaseConfig = {
  pool: {
    max: 20, // Maximum connections
    min: 5, // Minimum connections
    acquire: 30000, // Maximum time to get connection
    idle: 10000 // Maximum idle time
  }
}
```

### 2. Indexing

```sql
-- Add indexes for better performance
CREATE INDEX CONCURRENTLY idx_users_company_id ON users(company_id);
CREATE INDEX CONCURRENTLY idx_leaves_user_id ON leaves(user_id);
CREATE INDEX CONCURRENTLY idx_leaves_date_start ON leaves(date_start);
```

### 3. Query Optimization

```javascript
// Use Prisma's include and select for efficient queries
const usersWithDepartments = await prisma.users.findMany({
  select: {
    id: true,
    name: true,
    lastname: true,
    departments: {
      select: {
        name: true
      }
    }
  }
})
```

## Monitoring

### 1. Database Monitoring

```sql
-- Monitor active connections
SELECT count(*) FROM pg_stat_activity;

-- Monitor slow queries
SELECT query, mean_time, calls
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;
```

### 2. Application Monitoring

```javascript
// Add database health check endpoint
app.get('/health/database', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'healthy', database: 'postgresql' })
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', error: error.message })
  }
})
```

## Conclusion

This migration guide provides a comprehensive approach to moving from SQLite to PostgreSQL while maintaining compatibility with both Prisma and Sequelize. The key is to:

1. **Plan carefully** - Test thoroughly in development
2. **Backup everything** - Keep SQLite as fallback
3. **Monitor performance** - Optimize for PostgreSQL
4. **Document changes** - Keep track of configuration differences

Your existing code is already well-structured for this migration, making the process relatively straightforward.
