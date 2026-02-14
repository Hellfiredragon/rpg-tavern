#!/usr/bin/env bash
# Print an architecture overview extracted from source file header comments.
#
# Python files: first paragraph of the module docstring (via ast.get_docstring).
# TypeScript/TSX files: first /** ... */ JSDoc block before imports.
#
# Usage: scripts/arch.sh

set -euo pipefail
cd "$(dirname "$0")/.."

# ── Python docstring extractor (via ast) ─────────────────────────────────────

extract_py() {
    python3 -c "
import ast, sys, textwrap

with open(sys.argv[1]) as f:
    tree = ast.parse(f.read())
ds = ast.get_docstring(tree)
if ds:
    # First paragraph only
    para = ds.split('\n\n')[0]
    # Collapse to single line
    line = ' '.join(para.split())
    print(line)
" "$1" 2>/dev/null
}

# ── TypeScript/TSX JSDoc extractor (regex) ───────────────────────────────────

extract_ts() {
    python3 -c "
import re, sys

with open(sys.argv[1]) as f:
    content = f.read()

# Match /** ... */ at the start of the file (possibly with leading whitespace)
m = re.match(r'\s*/\*\*(.*?)\*/', content, re.DOTALL)
if m:
    body = m.group(1)
    # Strip leading * on each line
    lines = []
    for line in body.split('\n'):
        line = re.sub(r'^\s*\*\s?', '', line)
        lines.append(line)
    text = ' '.join(lines).strip()
    # First sentence/paragraph
    para = text.split('\n\n')[0]
    line = ' '.join(para.split())
    print(line)
" "$1" 2>/dev/null
}

# ── Tree printer ─────────────────────────────────────────────────────────────

COL=24  # filename column width

print_file() {
    local file="$1"
    local base
    base=$(basename "$file")
    local desc=""

    case "$file" in
        *.py)  desc=$(extract_py "$file") ;;
        *.ts|*.tsx) desc=$(extract_ts "$file") ;;
    esac

    if [[ -z "$desc" ]]; then
        desc="(no description)"
    fi

    # Truncate description to fit terminal
    local max_desc=100
    if [[ ${#desc} -gt $max_desc ]]; then
        desc="${desc:0:$max_desc}..."
    fi

    printf "  %-${COL}s %s\n" "$base" "$desc"
}

print_dir() {
    local dir="$1"
    local label="$2"
    local indent="${3:-}"

    echo "${indent}${label}"

    # Print files in this directory (sorted)
    local files=()
    while IFS= read -r -d '' f; do
        files+=("$f")
    done < <(find "$dir" -maxdepth 1 -type f \( -name '*.py' -o -name '*.ts' -o -name '*.tsx' \) -print0 | sort -z)

    for f in "${files[@]}"; do
        local base
        base=$(basename "$f")
        # Skip __init__.py, __pycache__, CSS, test config
        [[ "$base" == "__init__.py" ]] && continue
        [[ "$base" == "conftest.py" ]] && continue
        local desc=""
        case "$f" in
            *.py)  desc=$(extract_py "$f") ;;
            *.ts|*.tsx) desc=$(extract_ts "$f") ;;
        esac
        if [[ -z "$desc" ]]; then
            desc="(no description)"
        fi
        local max_desc=100
        if [[ ${#desc} -gt $max_desc ]]; then
            desc="${desc:0:$max_desc}..."
        fi
        printf "${indent}  %-${COL}s %s\n" "$base" "$desc"
    done

    # Print subdirectories
    local subdirs=()
    while IFS= read -r -d '' d; do
        subdirs+=("$d")
    done < <(find "$dir" -maxdepth 1 -mindepth 1 -type d -not -name '__pycache__' -not -name 'node_modules' -not -name '.git' -print0 | sort -z)

    for d in "${subdirs[@]}"; do
        local dname
        dname=$(basename "$d")
        # Check if directory has relevant files
        local count
        count=$(find "$d" -type f \( -name '*.py' -o -name '*.ts' -o -name '*.tsx' \) | head -1 | wc -l)
        if [[ $count -gt 0 ]]; then
            print_dir "$d" "${dname}/" "${indent}  "
        fi
    done
}

# ── Main ─────────────────────────────────────────────────────────────────────

echo "RPG Tavern — Architecture"
echo "Run: scripts/arch.sh"
echo ""

print_dir "backend" "backend/"
echo ""
print_dir "frontend/src" "frontend/src/"
echo ""
print_dir "tests" "tests/"
