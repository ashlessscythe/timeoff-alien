#!/bin/bash

# source .env file
source .env

# bried desccription of the script to user
echo "This script will start docker-compose with the environment variables from .env file"

# ask if user want to run this script
read -p "Do you want to run this script? (y/n) " -n 1 -r

# exit if user don't want to run this script
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Exiting..."
  echo
  exit 1
fi

# alert user if no database_url
if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is not set"
  exit 1
fi

# Parse components
decoded_url=$(printf '%b' "${DATABASE_URL//%/\\x}")
user="${decoded_url#*//}"
user="${user%:*}"
password="${decoded_url#*:*@}"
password="${password%:*}"
host="${decoded_url##*@}"
host="${host%:*}"
port="${decoded_url##*:}"
port="${port%/*}"
database="${decoded_url##*/}"

# Export variables for Docker Compose
export DB_USER=$user
export DB_PASSWORD=$password
export DB_HOST=$host
export DB_PORT=$port
export DB_NAME=$database

# Now these variables are set in the environment

# startup docker-compose
docker-compose up