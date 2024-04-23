#!/bin/bash

# Display usage information
function usage() {
  echo "Usage: $0 <csv_file> [column_number]"
  echo "  <csv_file>     Path to the CSV file."
  echo "  [column_number] The column number to extract unique values from (default is 1)."
  exit 1
}

# Check the number of arguments
if [ $# -lt 1 ]; then
  usage
fi

# Assuming the CSV file name is provided as the first argument to the script
csv_file="$1"
# The column number is the second argument, defaulting to the first column if not provided
column_number="${2:-1}"

# Check if the file exists
if [ ! -f "$csv_file" ]; then
  echo "File not found: $csv_file"
  usage
fi

# Ensure column_number is a valid number
if ! [[ "$column_number" =~ ^[0-9]+$ ]]; then
  echo "Invalid column number: $column_number"
  usage
fi

# Extract the unique values from the specified column
# Skip the first line to avoid including the header
# Cut to get the specified column
# Sort and get unique values
tail -n +2 "$csv_file" | cut -d ',' -f$column_number | sort | uniq
