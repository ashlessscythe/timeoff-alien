#!/bin/bash
# sync_public.sh

# Ensure you're on the dev branch
git checkout dev

# Optional: Create a tag
read -p "Enter tag name (leave blank to skip): " TAG
if [ ! -z "$TAG" ]; then
  git tag -a "$TAG" -m "Release $TAG"
  git push --tags
fi

# Sync public to dev
git switch public
git reset --hard dev
git push --force
git switch dev

echo "Public branch synced with dev successfully!"
