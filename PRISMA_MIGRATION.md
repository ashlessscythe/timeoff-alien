# Prisma Migration for Users Endpoint

This document describes the migration from Sequelize to Prisma for the `/users` endpoint to improve performance.

## What Was Done

### 1. Created Prisma Client Setup
- **File**: `lib/prisma/client.js`
- **Purpose**: Singleton Prisma client with proper configuration for development and production
- **Features**:
  - Connection pooling
  - Proper logging levels
  - Graceful shutdown handling

### 2. Created User Utility Functions
- **File**: `lib/prisma/userUtils.js`
- **Purpose**: Replicate Sequelize model methods for Prisma
- **Functions**:
  - `fullName(user)` - Calculate user's full name
  - `isActive(user)` - Check if user is active
  - `calculateNumberOfDaysTakenFromAllowance(user, leaves)` - Calculate days taken
  - `getUserAllowance(user, year)` - Get user allowance information
  - `getUserSchedule(user)` - Get user schedule

### 3. Created Prisma-based Users Route
- **File**: `lib/route/users/prisma-users.js`
- **Purpose**: High-performance users endpoint using Prisma
- **Features**:
  - Single optimized query to fetch all user data
  - Parallel processing of user calculations
  - Proper error handling
  - CSV export support

### 4. Added New Route
- **Path**: `/users-prisma/`
- **Purpose**: Test the new Prisma implementation alongside the existing Sequelize version

## Performance Improvements

### Query Optimization
1. **Single Query**: Instead of multiple nested queries, Prisma version uses a single query with proper includes
2. **Parallel Processing**: User calculations (allowance, schedule) are processed in parallel
3. **Reduced N+1 Queries**: All related data is fetched in one go

### Expected Performance Gains
- **Faster Query Execution**: Prisma generates more efficient SQL
- **Reduced Database Round-trips**: Single query vs multiple queries
- **Better Connection Pooling**: Prisma's built-in connection management
- **Optimized Data Loading**: Parallel processing of user calculations

## How to Test

### 1. Start the Server
```bash
npm start
# or
node app.js
```

### 2. Access Both Endpoints
- **Original (Sequelize)**: `http://localhost:3000/users/`
- **New (Prisma)**: `http://localhost:3000/users-prisma/`

### 3. Run Performance Test
```bash
node test-performance.js
```

This will:
- Make 5 requests to each endpoint
- Measure response times
- Compare performance
- Show detailed results

### 4. Manual Testing
You can also manually test by:
1. Opening both URLs in your browser
2. Comparing page load times
3. Checking that both show the same data

## Migration Strategy

### Phase 1: Parallel Testing (Current)
- Both implementations run side by side
- Performance testing and validation
- Bug fixes and optimizations

### Phase 2: Gradual Migration
- Replace Sequelize route with Prisma route
- Monitor performance in production
- Keep fallback option available

### Phase 3: Full Migration
- Remove Sequelize dependencies for users endpoint
- Clean up unused code
- Optimize further based on production data

## Files Modified

1. **app.js** - Added new Prisma route
2. **lib/prisma/client.js** - New Prisma client setup
3. **lib/prisma/userUtils.js** - New utility functions
4. **lib/route/users/prisma-users.js** - New Prisma-based route
5. **test-performance.js** - Performance testing script

## Dependencies

The following Prisma packages are already installed:
- `@prisma/client`: ^5.21.0
- `prisma`: ^5.21.0

## Database Schema

The Prisma schema (`prisma/schema.prisma`) is already set up and matches the existing database structure. No schema changes are required.

## Monitoring

After deployment, monitor:
- Response times
- Database query performance
- Error rates
- Memory usage
- CPU usage

## Rollback Plan

If issues arise:
1. Remove the Prisma route from `app.js`
2. Restart the server
3. The original Sequelize implementation will continue working
4. Investigate and fix issues before retrying

## Next Steps

1. Run performance tests
2. Compare results
3. If Prisma shows better performance, proceed with full migration
4. If not, investigate bottlenecks and optimize further
5. Consider migrating other endpoints to Prisma for consistency
