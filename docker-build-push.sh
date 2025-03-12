#!/bin/bash

# Exit on any error
set -e

# Default tag
TAG=${1:-latest}
IMAGE_NAME="ashless/timeoff-alien"

echo "🏗️ Building Docker image: $IMAGE_NAME:$TAG"
docker build -t $IMAGE_NAME:$TAG .

echo "⬆️ Pushing Docker image to Docker Hub"
docker push $IMAGE_NAME:$TAG

echo "✅ Successfully built and pushed $IMAGE_NAME:$TAG"

# If this is not the latest tag, also update latest if confirmation is given
if [ "$TAG" != "latest" ]; then
    read -p "Do you want to update 'latest' tag as well? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🏷️ Tagging and pushing as latest"
        docker tag $IMAGE_NAME:$TAG $IMAGE_NAME:latest
        docker push $IMAGE_NAME:latest
        echo "✅ Successfully updated latest tag"
    fi
fi
