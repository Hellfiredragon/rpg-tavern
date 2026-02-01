#!/usr/bin/env bash
trap 'kill 0' EXIT

bun vite build

PORT="${PORT:-13013}"
export PORT
WSL_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "WSL IP:  http://${WSL_IP}:${PORT}"
echo ""

bun vite build --watch &
bun run --watch src/server.ts &
wait
