# TimeOff Alien Docker Image

Docker image for TimeOff Management application with enhanced features.

## Quick Start

```bash
# Pull the image
docker pull ashless/timeoff-alien

# Run with Docker Compose (recommended)
docker-compose up -d

# Or run standalone
docker run -d -p 3000:3000 --env-file .env --name timeoff ashless/timeoff-alien
```

## Environment Variables

Copy the example environment file and modify as needed:

```bash
cp .env.example .env
```

Key environment variables:

- `DATABASE_URL`: Full database connection URL (recommended for production)
- `DB_*`: Individual database connection parameters (DB_HOST, DB_USER, etc.)
- `SMTP_*`: Email configuration
- `CRYPTO_SECRET`: Secret key for password hashing
- `SESSION_SECRET`: Secret key for session management

## Database Options

1. **External Database (Recommended for Production)**
   - Set `DATABASE_URL` in .env
   - Example: `DATABASE_URL=postgresql://user:pass@host:5432/dbname?sslmode=require`

2. **Local Database (Development)**
   - Uses Docker Compose with PostgreSQL container
   - Data persisted in Docker volume
   - Configure using `DB_*` variables

## Features

- 📅 Calendar, Team, and List views for absences
- ⚙️ Customizable company policies
- 🔄 Three-step workflow
- 🔒 Role-based access control
- 📊 CSV data export
- 📱 Mobile-friendly design

## Docker Compose Example

```yaml
version: '3.8'
services:
  web:
    image: ashless/timeoff-alien
    ports:
      - "3000:3000"
    env_file: .env
    depends_on:
      - db
    restart: unless-stopped

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: ${DB_DATABASE}
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  postgres_data:
```

## Tags

- `latest`: Latest stable release
- `dev`: Development build

## Support

Please report any issues or feedback by opening an issue in the [GitHub repository](https://github.com/ashlessscythe/timeoff-alien).
