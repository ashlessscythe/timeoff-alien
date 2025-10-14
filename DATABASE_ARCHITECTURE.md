# Database Architecture Diagram

## Current Setup: SQLite + Prisma + Sequelize

```
┌─────────────────────────────────────────────────────────────┐
│                    TimeOff Management App                   │
├─────────────────────────────────────────────────────────────┤
│  Application Layer                                          │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │     Prisma      │    │           Sequelize             │ │
│  │   (Primary)     │    │        (Legacy/Support)         │ │
│  └─────────────────┘    └─────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  Database Layer                                             │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                SQLite Database                          │ │
│  │              (file:../app.sqlite)                      │ │
│  │                                                         │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │ │
│  │  │  companies  │  │   users     │  │ departments │     │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘     │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │ │
│  │  │   leaves    │  │  schedules  │  │bank_holidays│     │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘     │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │ │
│  │  │leave_types  │  │   audit     │  │  comments   │     │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘     │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Alternative Setup: PostgreSQL + Prisma + Sequelize

```
┌─────────────────────────────────────────────────────────────┐
│                    TimeOff Management App                   │
├─────────────────────────────────────────────────────────────┤
│  Application Layer                                          │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │     Prisma      │    │           Sequelize             │ │
│  │   (Primary)     │    │        (Legacy/Support)         │ │
│  └─────────────────┘    └─────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  Database Layer                                             │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              PostgreSQL Server                         │ │
│  │         (postgresql://user:pass@host:5432/db)          │ │
│  │                                                         │ │
│  │  ┌─────────────────────────────────────────────────────┐ │ │
│  │  │                public schema                       │ │ │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │ │ │
│  │  │  │  companies  │  │   users     │  │ departments │ │ │ │
│  │  │  └─────────────┘  └─────────────┘  └─────────────┘ │ │ │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │ │ │
│  │  │  │   leaves    │  │  schedules  │  │bank_holidays│ │ │ │
│  │  │  └─────────────┘  └─────────────┘  └─────────────┘ │ │ │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │ │ │
│  │  │  │leave_types  │  │   audit     │  │  comments   │ │ │ │
│  │  │  └─────────────┘  └─────────────┘  └─────────────┘ │ │ │
│  │  └─────────────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow Comparison

### SQLite Data Flow

```
App Request → Prisma/Sequelize → SQLite File → Response
     ↓              ↓              ↓
  Single-threaded  File I/O    Local storage
```

### PostgreSQL Data Flow

```
App Request → Prisma/Sequelize → PostgreSQL Server → Response
     ↓              ↓                ↓
  Multi-threaded  Network I/O    Remote storage
```

## Key Differences Summary

| Aspect          | SQLite              | PostgreSQL            |
| --------------- | ------------------- | --------------------- |
| **Storage**     | File-based          | Server-based          |
| **Concurrency** | Single-threaded     | Multi-threaded        |
| **Network**     | None (local)        | Required              |
| **Setup**       | Simple              | Requires server       |
| **Performance** | Good for small apps | Better for large apps |
| **Features**    | Basic               | Advanced              |

## Migration Path

```
Current State: SQLite
        ↓
   [Optional] Test with PostgreSQL
        ↓
   [Optional] Migrate to PostgreSQL
        ↓
   Production: PostgreSQL
```

## Configuration Files

### Prisma Schema

```prisma
// Current (SQLite)
datasource db {
  provider = "sqlite"
  url      = "file:../app.sqlite"
}

// Future (PostgreSQL)
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### Environment Variables

```bash
# SQLite
DATABASE_URL=file:../app.sqlite

# PostgreSQL
DATABASE_URL=postgresql://user:password@localhost:5432/timeoff_management
```

## Testing Commands

```bash
# Test current SQLite setup
node scripts/database-switch-example.js sqlite

# Test PostgreSQL setup (if configured)
node scripts/database-switch-example.js postgresql

# Seed database
node prisma/seed.mjs --clear
```

This architecture shows how your application can seamlessly work with both database types while maintaining the same functionality.
