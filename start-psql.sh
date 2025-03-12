#!/bin/bash

# Check if .env file exists
if [ ! -f .env ]; then
    echo "Error: .env file not found!"
    echo "Please copy .env.example to .env and update the variables:"
    echo "cp .env.example .env"
    exit 1
fi

# Source the .env file
source .env

# Check if required environment variables are set
if [ -z "$DB_DATABASE" ] || [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ]; then
    echo "Error: Required environment variables not set."
    echo "Please ensure these variables are set in your .env file:"
    echo "  DB_DATABASE"
    echo "  DB_USER"
    echo "  DB_PASSWORD"
    exit 1
fi

# Check if running in Docker Compose
if [ "$USE_DOCKER_COMPOSE" = "true" ]; then
    DB_HOST="dbase"
    echo "Using Docker Compose configuration:"
else
    DB_HOST="localhost"
    echo "Using standalone configuration:"
fi

echo "  Database: ${DB_DATABASE}"
echo "  User: ${DB_USER}"
echo "  Port: ${DB_PORT:-5432}"
echo "  Host: ${DB_HOST}"

if [ "$USE_DOCKER_COMPOSE" != "true" ]; then
    # Start the PostgreSQL container only if not using Docker Compose
    docker run -d \
      --name dbase \
      -e POSTGRES_DB="${DB_DATABASE}" \
      -e POSTGRES_USER="${DB_USER}" \
      -e POSTGRES_PASSWORD="${DB_PASSWORD}" \
      -p "${DB_PORT:-5432}:5432" \
      -v postgres_data:/var/lib/postgresql/data \
      postgres:latest

    echo "Waiting for PostgreSQL to start..."
    sleep 5
fi

# Create and export the URL
URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT:-5432}/${DB_DATABASE}"
echo "export URL='${URL}'"

if [ "$USE_DOCKER_COMPOSE" = "true" ]; then
    echo "PostgreSQL service configured in docker-compose.yaml"
    echo "Start the services with: docker-compose up -d"
else
    echo "PostgreSQL container started successfully!"
fi

echo "Run this script with:"
echo "eval \$(./start-psql.sh)"
echo "Then you can use pgcli with:"
echo "pgcli \$URL"
