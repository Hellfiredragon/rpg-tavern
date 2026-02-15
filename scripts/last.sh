#!/usr/bin/env bash
# Show the most recently used adventure and optionally its messages.
#
# Usage:
#   scripts/last.sh                    Show last-used adventure summary
#   scripts/last.sh --messages         Also show messages (last 20)
#   scripts/last.sh --messages -n 5    Show last 5 messages
#   scripts/last.sh --messages -n 0    Show all messages

set -euo pipefail
cd "$(dirname "$0")/.."

SHOW_MESSAGES=0
MSG_COUNT=20

while [[ $# -gt 0 ]]; do
    case "$1" in
        -m|--messages) SHOW_MESSAGES=1; shift ;;
        -n) MSG_COUNT="$2"; shift 2 ;;
        *)  echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

DATA_DIR="${DATA_DIR:-data}"

python3 - "$DATA_DIR" "$SHOW_MESSAGES" "$MSG_COUNT" <<'PYEOF'
import json, sys
from datetime import datetime
from pathlib import Path

data_dir = Path(sys.argv[1])
show_messages = sys.argv[2] == "1"
msg_count = int(sys.argv[3])

adventures_dir = data_dir / "adventures"
if not adventures_dir.is_dir():
    print("No adventures directory found.")
    sys.exit(1)

# Load all adventure JSON files
adventures = []
for p in adventures_dir.glob("*.json"):
    try:
        adv = json.loads(p.read_text())
        adventures.append(adv)
    except (json.JSONDecodeError, OSError):
        continue

if not adventures:
    print("No adventures found.")
    sys.exit(1)

# Sort by updated_at (falling back to created_at)
def sort_key(a):
    return a.get("updated_at", a.get("created_at", ""))

adventures.sort(key=sort_key, reverse=True)
adv = adventures[0]

slug = adv["slug"]

# Count messages
msgs_path = adventures_dir / slug / "messages.json"
messages = []
if msgs_path.is_file():
    try:
        messages = json.loads(msgs_path.read_text())
    except (json.JSONDecodeError, OSError):
        pass

def fmt_ts(iso):
    if not iso:
        return "—"
    try:
        dt = datetime.fromisoformat(iso)
        return dt.strftime("%Y-%m-%d %H:%M")
    except (ValueError, TypeError):
        return iso

print("RPG Tavern — Last Adventure")
print("Run: scripts/last.sh")
print()
print(f"Adventure: {adv.get('title', '?')}")
print(f"Slug:      {slug}")
print(f"Template:  {adv.get('template_slug', '—')}")
print(f"Created:   {fmt_ts(adv.get('created_at'))}")
print(f"Updated:   {fmt_ts(adv.get('updated_at'))}")
print(f"Messages:  {len(messages)}")

if show_messages and messages:
    print()
    display = messages if msg_count == 0 else messages[-msg_count:]
    print(f"--- Messages (last {len(display) if msg_count else 'all'}) ---")
    for msg in display:
        ts = ""
        if "ts" in msg:
            try:
                dt = datetime.fromisoformat(msg["ts"])
                ts = dt.strftime("[%H:%M] ")
            except (ValueError, TypeError):
                pass
        role = msg.get("role", "?")
        text = msg.get("text", "")
        # Collapse to single line and truncate
        line = " ".join(text.split())
        if len(line) > 100:
            line = line[:97] + "..."
        print(f"{ts}{role}: {line}")
PYEOF
