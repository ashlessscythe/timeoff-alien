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

Available seed options:

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

**Database URL Notes**:

- Use `DATABASE_URL` for external/hosted databases (production)
- Use `DOCKER_DB_URL` for local Docker databases (development)
- Don't use both simultaneously - choose one based on your setup

For a complete list of options, refer to the `.env.example` file in the project root.

## 🧪 Run tests

```bash
USE_CHROME=1 npm test
```

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
