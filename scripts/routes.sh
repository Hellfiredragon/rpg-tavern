#!/usr/bin/env bash
# Print all backend API and frontend page routes with descriptions.
#
# Backend: extracted from @router decorators + handler docstrings in backend/routes/.
# Frontend: extracted from JSDoc route comments in App.tsx.
#
# Usage: scripts/routes.sh

set -euo pipefail
cd "$(dirname "$0")/.."

# ── Backend routes (from routes.py via AST) ──────────────────────────────────

echo "RPG Tavern — Routes"
echo "Run: scripts/routes.sh"
echo ""
echo "Backend API (under /api)"
echo ""

python3 -c "
import ast, pathlib, sys

routes_dir = pathlib.Path('backend/routes')
files = sorted(routes_dir.glob('*.py'))
for filepath in files:
    if filepath.name == '__init__.py' or filepath.name == 'models.py':
        continue
    tree = ast.parse(filepath.read_text())
    for node in ast.iter_child_nodes(tree):
        if not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
            continue
        for dec in node.decorator_list:
            if not isinstance(dec, ast.Call):
                continue
            if not isinstance(dec.func, ast.Attribute):
                continue
            method = dec.func.attr.upper()
            if method not in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE'):
                continue
            path = dec.args[0].value if dec.args else ''
            ds = ast.get_docstring(node) or '(no description)'
            desc = ds.split(chr(10))[0]
            print(f'  {method:<8s} /api{path:<50s} {desc}')
            break
"

# ── Frontend routes (from App.tsx JSDoc) ─────────────────────────────────────

echo ""
echo "Frontend Pages"
echo ""

python3 -c "
import re

with open('frontend/src/App.tsx') as f:
    content = f.read()

# Extract from JSDoc block: lines matching '  *   /path   description'
m = re.search(r'/\*\*(.*?)\*/', content, re.DOTALL)
if not m:
    sys.exit(0)

for line in m.group(1).split('\n'):
    # Strip leading ' * ' and look for route lines starting with /
    cleaned = re.sub(r'^\s*\*\s?', '', line).strip()
    if cleaned.startswith('/'):
        parts = cleaned.split(None, 1)
        if len(parts) == 2:
            route, desc = parts
            print(f'  {route:<30s} {desc}')
        else:
            print(f'  {parts[0]}')
"
