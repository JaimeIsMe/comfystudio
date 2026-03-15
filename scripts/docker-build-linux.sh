#!/usr/bin/env bash
# Build Linux AppImage and .deb in Docker. Artifacts are written to ./release/
set -e
cd "$(dirname "$0")/.."
DOCKER_PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"
DOCKER_BUILD_ARGS=()
if [ -n "${CUSTOM_CA_CERT_B64:-}" ]; then
  DOCKER_BUILD_ARGS+=(--build-arg "CUSTOM_CA_CERT_B64=${CUSTOM_CA_CERT_B64}")
fi

docker build --platform "${DOCKER_PLATFORM}" "${DOCKER_BUILD_ARGS[@]}" -f Dockerfile.linux-build -t comfystudio-linux-build .
mkdir -p release
docker run --platform "${DOCKER_PLATFORM}" --rm -v "$(pwd)/release:/out" comfystudio-linux-build sh -lc "cp -R /app/release/. /out/ && ls -la /out"
echo "Linux artifacts are in ./release/"
