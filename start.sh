docker stop router 2>/dev/null || true
docker rm router 2>/dev/null || true
docker run -d \
  --name router \
  --restart always \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  -e NODE_ENV=production \
  ghcr.io/iamsdr/router:latest