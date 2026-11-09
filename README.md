# TimeOff.Management

Web application for managing employee leave requests.

## Features

- Multiple views of staff absences: calendar, team, or plain list
- Customizable to fit your company policy
- Third-party calendar integration
- Three-step approval workflow
- Access control with different user types
- Data extraction to CSV and encrypted full backups
- Theme selector, mobile-friendly design
- Fast leaves report

## Quick start (Docker Compose)

Requires Docker with the Compose plugin.

```bash
git clone https://github.com/ashlessscythe/timeoff-alien.git
cd timeoff-alien
cp .env.example .env
```

Edit `.env` and at least change `SESSION_SECRET` and `BACKUP_ENCRYPTION_KEY` (32+ characters; `openssl rand -hex 32` works). Then:

```bash
docker compose up -d
```

The app is available at http://localhost:3000 (or your `APP_PORT`). Database migrations run automatically on container start.

`docker compose up` uses the published image `ashless/timeoff-alien` when available, and builds from the local `Dockerfile` otherwise. To run your local code, build explicitly:

```bash
docker compose up -d --build
```

### Database choice

**Local database (default)** – the compose file starts a PostgreSQL container and the app connects to it through `DOCKER_DB_URL`. Nothing to change; the `DB_*` values in `.env` configure the container and must match `DOCKER_DB_URL`. Data lives in the `postgres_data` volume.

**External database (production)** – for a hosted Postgres (Neon, Supabase, RDS, ...):

1. In `.env`, set `DATABASE_URL` (e.g. `postgresql://user:pass@host/dbname?sslmode=require`) and remove or comment out `DOCKER_DB_URL` and the `DB_*` variables. If `DOCKER_DB_URL` is set, it takes precedence inside the container.
2. In `docker-compose.yaml`, remove the `postgres` service and the `postgres_data` volume.

Alternatively, keep the file as is and start only the app with `docker compose up -d web`.

### Seeding sample data (optional)

Run the seed inside the running container:

```bash
docker compose exec web npx prisma db seed -- --create-default-user --user-count 20
```

This creates a default admin (`bob@local.eml` / `bob`) plus 20 sample users with leave data. Without Compose, seed from a source checkout (`npm install`) with `DATABASE_URL` pointing at your database (for the local container use `localhost:5432`).

Seed options:

- `--clear`: clear existing data first (**destructive**)
- `--user-count` (alias `--use-faker`): number of users (default 10)
- `--leaves-multiplier`: leaves per user multiplier (default 3)
- `--department-count`: departments (default 5)
- `--company-id`: company ID (default 1)
- `--create-default-user`: create the default admin
- `--date-from` / `--date-to`: leave date range (YYYY-MM-DD)
- `--bank-holiday-count`: bank holidays (default 8)
- `--custom-schedule-percent`: percent of users with custom schedules (default 30)
- `--uaa`: path to a CSV of user allowance adjustments

### Plain `docker run`

```bash
docker run -d -p 3000:3000 --env-file .env --name timeoff ashless/timeoff-alien
```

This needs an external database: `DATABASE_URL` in `.env` must be reachable from the container.

## Running without Docker

Requires **Node.js 24.18.0+** (see [`.node-version`](./.node-version)) and a PostgreSQL database.

```bash
nvm install && nvm use      # or: fnm install && fnm use
cp .env.example .env        # set DATABASE_URL, SESSION_SECRET, BACKUP_ENCRYPTION_KEY
npm install
npm run build               # compile assets
npm start                   # prisma generate + migrate deploy + production server
```

`./start-psql.sh` starts a standalone local Postgres container if you need one. For development, `npm run dev` starts the server without migrations.

**Windows (PowerShell) + fnm**: add this to your `$PROFILE` so Node activates per project, then open a new terminal and check `node -v`:

```powershell
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
```

## Configuration

Settings come from environment variables (see [`.env.example`](./.env.example) for the full list). Key ones:

- `DATABASE_URL`: database URL (external DB, or host-side tooling)
- `DOCKER_DB_URL`: database URL for the bundled compose Postgres; overrides `DATABASE_URL` in the container
- `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`: bundled Postgres container settings
- `APP_PORT`: port to serve on (default 3000)
- `SESSION_SECRET`: session signing secret (**change it**)
- `BACKUP_ENCRYPTION_KEY`: key for encrypted backups, 32+ characters
- `BRANDING_URL`, `BRANDING_WEBSITE`, `HEADER_TITLE`: branding
- `OPTION_ALLOW_NEW_REGISTRATIONS`: allow new company registrations (disable in production after setup)
- `SMTP_*` or `RESEND_API_KEY`, `SEND_EMAIL`: email

## Run tests

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

## Backup and Restore

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

## Updating an existing instance

Docker Compose:

```bash
git pull
docker compose pull web      # if using the published image
docker compose up -d --build
```

Without Docker:

```bash
git pull
npm install
npm run build
npm start                    # applies pending migrations
```

## Customization

- Extend colors for leave types
- Configure locale-sensitive sorting
- Force explicit leave type selection

## Feedback

Please report issues by opening a GitHub issue.
