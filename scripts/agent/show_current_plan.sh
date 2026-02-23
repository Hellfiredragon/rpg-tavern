#!/usr/bin/env bash
# Print the contents of the highest-numbered plan file in docs/plans/.
# Usage: bash scripts/agent/show_current_plan.sh

PLANS_DIR="$(cd "$(dirname "$0")/../.." && pwd)/docs/plans"

latest=$(ls "$PLANS_DIR"/current_plan_*.md 2>/dev/null | sort | tail -1)

if [[ -z "$latest" ]]; then
  echo "No plan files found in $PLANS_DIR" >&2
  exit 1
fi

echo "=== $(basename "$latest") ==="
echo ""
cat "$latest"
