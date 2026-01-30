#!/usr/bin/env bash
set -e

#PORT="${PORT:-$((13000 + RANDOM % 1000))}"
PORT="13013"
WSL_IP=$(hostname -I | awk '{print $1}')

echo "Starting RPG Tavern..."
echo ""
echo "  Local:   http://localhost:${PORT}"
echo "  WSL IP:  http://${WSL_IP}:${PORT}"
echo ""

export DEV=1
export PORT
exec bun run --watch src/server.ts
