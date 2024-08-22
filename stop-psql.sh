#!/bin/bash

# Function to print usage
usage() {
    echo "Usage: $0 [--delete-volume]"
    echo "  --delete-volume    Delete the associated volume (optional)"
}

# Initialize delete_volume flag
delete_volume=false

# Parse command line arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --delete-volume) delete_volume=true ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown parameter: $1"; usage; exit 1 ;;
    esac
    shift
done

# Stop the PostgreSQL container
docker stop postgres_db

# Remove the container
docker rm postgres_db

# Remove the volume if --delete-volume flag is set
if [ "$delete_volume" = true ] ; then
    docker volume rm postgres_data
    echo "PostgreSQL volume deleted."
else
    echo "PostgreSQL volume preserved. Use --delete-volume to delete it."
fi

echo "PostgreSQL container stopped and removed."
echo "The DB_URL environment variable is no longer valid."