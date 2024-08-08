#!/bin/bash

# Start the PostgreSQL container
docker run -d \
  --name postgres_db \
  -e POSTGRES_DB=pgdb \
  -e POSTGRES_USER=pguser \
  -e POSTGRES_PASSWORD=pgpass \
  -e POSTGRES_ROOT_PASSWORD=pgrootpass \
  -p 5432:5432 \
  -v postgres_data:/var/lib/postgresql/data \
  postgres:latest

# Wait for a few seconds to ensure the container is up and running
sleep 5

# Export the DB_URL for pgcli
export DB_URL="postgresql://pguser:pgpass@localhost:5432/pgdb"

echo "PostgreSQL container started."
echo "DB_URL has been exported. You can now use pgcli with the following command:"
echo "pgcli \$DB_URL"