# 🚀 TimeOff.Management

📅 Web application for managing employee leave requests with style!

## ✨ Features

### 🆕 New Features

- 🎨 Theme selector: Customize your TimeOff.Management experience!
- 📊 Faster leaves report: Get insights quicker than ever!
- 📅 Date of request added to leaves table under calendar
- 🌱 Optimized seed script for better performance
- 🔧 Cloudflare scripts fix for improved reliability

### Existing Features

- 👥 Multiple views of staff absences: Calendar view, Team view, or Just plain list
- ⚙️ Customizable to fit your company policy
- 🔗 Third Party Calendar Integration
- 🔄 Three Steps Workflow
- 🔒 Access control with different user types
- 📊 Data extraction to CSV
- 📱 Mobile-friendly design
- 💡 Many other convenient features

## 🛠️ Installation

### Node.js prerequisites

Local installs (and asset builds) expect **Node.js 22.22.2+** (see [`.node-version`](./.node-version); matches current dependency engines such as `express-handlebars`).

```bash
# fnm
fnm install
fnm use

# nvm
nvm install
nvm use
```

**Windows (PowerShell) + fnm**: Node may not activate until fnm is hooked into your shell. Add this to your PowerShell profile (`$PROFILE`), then open a new terminal in the project folder:

```powershell
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
```

Confirm with `node -v` (should report **v22.22.2** or newer). Use `npm run build` to compile assets — that command is cross-platform on Windows, macOS, and Linux.

### 🏠 Self hosting

1. Clone and prepare the repository:

```bash
git clone https://github.com/ashlessscythe/timeoff-alien.git timeoff-alien
cd timeoff-alien
cp .env.example .env
```

2. Choose your database configuration in `.env`:

   **Option 1: External Database (recommended for production)**

   - If you're using a hosted database (Neon/Render/Vercel/Supabase), set your `DATABASE_URL`
   - Comment out Option 2 (`DOCKER_DB_URL`, `DB_*` variables)
   - Comment out the postgres service in `docker-compose.yaml`

   **Option 2: Local Database (default, recommended for development)**

   - Uses the included PostgreSQL Docker container
   - No changes needed to `.env` or `docker-compose.yaml`
   - Database will be automatically configured

3. Start the application:

```bash
docker compose up -d
```

The application will be available at http://localhost:3000

4. (Optional) Seed the database with sample data:

```bash
npx prisma db seed -- --create-default-user --use-faker --count 20
```

This creates a default admin user (bob@local.eml/bob) and 20 sample users with data.

#### 🐳 Alternative: Using Docker without Compose

If you're more tech-savvy and prefer to manage containers manually:

```bash
docker pull ashless/timeoff-alien
docker run -d -p 3000:3000 --env-file .env --name timeoff ashless/timeoff-alien
```

### 💾 Database Configuration

The application supports two database setup options:

1. **External Database (recommended for production)**

   - Uses a hosted database service (e.g., AWS RDS, Neon, Supabase)
   - Set `DATABASE_URL` in `.env` (not `DOCKER_DB_URL`)
   - Comment out or remove `DOCKER_DB_URL` and `DB_*` variables
   - Comment out the postgres service in `docker-compose.yaml`
   - Better scalability and maintenance
   - Automatic backups and monitoring
   - Example: `DATABASE_URL="postgresql://hosted:db@coolprovider.com/dbname?sslmode=require"`

2. **Local Database (recommended for development)**
   - Runs PostgreSQL in a Docker container
   - Data persisted in a Docker volume
   - Easy setup for development
   - Includes optional Adminer for database management
   - Configure using `DOCKER_DB_URL` and `DB_*` variables in `.env`
   - Optional: there's a helper script `./start-psql.sh` to start a local docker psql separately

**Important**: When using an external database, make sure to use `DATABASE_URL` (not `DOCKER_DB_URL`) and comment out the postgres service in your docker-compose file to avoid conflicts.

Choose the option that best fits your needs. For development, the local database option provides a simpler setup. For production, an external database offers better reliability and features.

### 🌱 Database Seeding

The application includes a powerful seeding system for populating your database with test data. You can run the seed with various options:

```bash
# Basic seeding with defaults
npx prisma db seed

# Clear existing data before seeding
npx prisma db seed -- --clear   # (CAREFUL, this is destrucive!)

# Customize the seed data
npx prisma db seed -- --user-count 20 --leaves-multiplier 5
```

Available options for seeding:

- `--clear`: Clear all data before seeding
- `--user-count` or `--use-faker`: Number of users to create (default: 10)
- `--leaves-multiplier`: Multiplier for leaves per user (default: 3)
- `--department-count`: Number of departments to create (default: 5)
- `--company-id`: Company ID to use (default: 1)
- `--create-default-user`: Create default admin user (bob@local.eml/bob)
- `--date-from`: Start date for leaves (YYYY-MM-DD)
- `--date-to`: End date for leaves (YYYY-MM-DD)
- `--bank-holiday-count`: Number of bank holidays to create (default: 8)
- `--custom-schedule-percent`: Percentage of users with custom schedules (default: 30)
- `--uaa`: Path to CSV file for user allowance adjustments

The seed creates:

- Company with departments (some including holidays, others not)
- Users with various roles (admins, managers)
- Leave types with fun names
- Bank holidays within the specified date range
- Custom work schedules for some users
- Leave records distributed across the date range

## ⚙️ Configuration

Configuration can be done through environment variables or JSON configuration files.

### 🔑 Environment Variables

Here's a summary of key environment variables you can set:

- `BRANDING_URI`: URL of the TimeOff.Management application
- `BRANDING_WEBSITE`: URL of your company's website
- `HEADER_TITLE`: Custom header title for the application
- `DATABASE_URL`: Full database URL (for external databases - use this, not DOCKER_DB_URL)
- `DOCKER_DB_URL`: Database URL for local Docker database (for development only)
- `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`: Database configuration (for local databases)
- `DB_DIALECT`: Database type (mysql, postgres, sqlite, mssql)
- `OPTION_ALLOW_NEW_REGISTRATIONS`: Set to true to allow new company registrations
- `SMTP_*`: Various SMTP settings for email configuration
- `SESSION_SECRET`: Secret key for session management
- `BACKUP_ENCRYPTION_KEY`: Encryption key for encrypted backups (must be at least 32 characters)

**Database URL Notes**:

- Use `DATABASE_URL` for external/hosted databases (production)
- Use `DOCKER_DB_URL` for local Docker databases (development)
- Don't use both simultaneously - choose one based on your setup

For a complete list of options, refer to the `.env.example` file in the project root.

## 🧪 Run tests

The suite uses [Vitest](https://vitest.dev/) (replacing Mocha). Integration tests use [supertest](https://github.com/ladjs/supertest) against the exported Express app (no browser).

| Command | What it does |
| --- | --- |
| `npm test` | Full suite: unit then integration |
| `npm run test:quick` | Same as unit — fast feedback, no database |
| `npm run test:unit` | `tests/unit/**/*.test.mjs` only ([`vitest.unit.config.js`](./vitest.unit.config.js)) |
| `npm run test:integration` | `tests/integration/**/*.test.mjs` ([`vitest.config.js`](./vitest.config.js), Postgres + `globalSetup`) |
| `npm run test:watch` | Vitest watch (default config; use for integration or pass `-c vitest.unit.config.js` for unit) |
| `npm run test:coverage` | Integration config with V8 coverage; reports under `coverage/` |

**Unit tests** do not load `globalSetup` and do not need a running database.

**Integration tests** expect Postgres. Copy [`.env.test.example`](./.env.test.example) to `.env.test` and set `DATABASE_URL` to a **dedicated** test database (not your dev data). `OPTION_ALLOW_NEW_REGISTRATIONS=true` is required for registration flows in tests.

```bash
# Quick (unit only, no DB)
npm run test:quick

# Everything CI-style
npm test

# Integration only (needs .env.test + Postgres)
npm run test:integration

# Watch mode (default vitest.config.js; Ctrl+C to exit)
npm run test:watch

# Unit tests in watch mode
npx vitest -c vitest.unit.config.js

# Coverage (V8): integration tests + text/html/lcov under coverage/
npm run test:coverage

# Unit-only coverage (same reporters, uses vitest.unit.config.js)
npx vitest run -c vitest.unit.config.js --coverage
```

## 💾 Backup and Restore

The application provides two backup methods:

### CSV Backup (Legacy)
- **Location**: Settings → General Settings → "Backup employees' leave data"
- **Format**: CSV file compatible with MS Excel
- **Content**: Employee leave data only
- **Use case**: Quick export for reporting or analysis

### Encrypted Full Database Backup (Recommended)
- **Location**: Settings → General Settings → "Encrypted full database backup"
- **Format**: Encrypted JSON file (AES-256-GCM)
- **Content**: Complete company data including:
  - Company settings
  - Users and departments
  - Leave types and leave requests
  - Schedules and bank holidays
  - Comments, audits, and all related records
- **Security**: Encrypted with a key from `BACKUP_ENCRYPTION_KEY` environment variable
- **Use case**: Full disaster recovery, migration, or data archival

#### Setting Up Encryption Key

1. Generate a secure random string (at least 32 characters):
   ```bash
   # Using OpenSSL
   openssl rand -hex 32

   # Or using Node.js
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. Add to your `.env` file:
   ```
   BACKUP_ENCRYPTION_KEY=your_generated_key_here
   ```

3. **Important**: Keep this key secure and backed up separately. You'll need it to restore backups.

#### Creating a Backup

1. Navigate to Settings → General Settings
2. Click "Download encrypted backup"
3. Save the JSON file securely
4. The backup includes metadata about what was backed up

#### Restoring a Backup

1. Navigate to Settings → General Settings
2. Scroll to "Restore encrypted backup"
3. **Recommended**: First run a dry run to preview what will be restored
   - Check "Dry run (preview only)"
   - Upload your backup file
   - Review the preview results
4. For actual restore:
   - Uncheck "Dry run"
   - Optionally check "Clear existing data before restore" (⚠️ destructive)
   - Upload your backup file
   - Confirm the action

**⚠️ Warning**: Restoring a backup will overwrite existing data. Always create a backup before restoring.

**Note**: The encryption key used for restore must match the key used when creating the backup.

## 🔄 Updating existing instance

```bash
git fetch
git pull origin public
npm install
npm run build
npm start
```

## 🎨 Customization

- Extend colors for leave types
- Configure locale-sensitive sorting
- Force explicit leave type selection

## 📣 Feedback

Please report any issues or feedback via by opening an issue

Happy time off management! 🌴🏖️
