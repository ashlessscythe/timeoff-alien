#!/bin/bash

# Check if an argument is provided
if [ $# -eq 0 ]; then
    echo "Please provide the SQL file as an argument."
    exit 1
fi

# Input SQL file
input_file=$1

# Output dump file
output_file="${input_file%.*}.dump"

# Create temporary database
temp_db="temp_db_$(date +%s)"
sudo -u postgres createdb $temp_db

# Import SQL into temporary database
sudo -u postgres psql $temp_db < $input_file

# Create compressed dump
sudo -u postgres pg_dump -Fc $temp_db > $output_file

# Drop temporary database
sudo -u postgres dropdb $temp_db

echo "Compressed dump created: $output_file"