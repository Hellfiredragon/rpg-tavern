"""RPG Tavern — dev launcher. Starts backend and frontend in watch mode."""

import argparse
import os
import signal
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")

HOST = os.getenv("HOST", "0.0.0.0")
BACKEND_PORT = os.getenv("BACKEND_PORT", "13013")
FRONTEND_PORT = os.getenv("FRONTEND_PORT", "13014")


def main():
    parser = argparse.ArgumentParser(description="RPG Tavern dev launcher")
    parser.add_argument("--data-dir", type=Path, default=None,
                        help="Data storage directory (default: ./data)")
    parser.add_argument("--demo", action="store_true",
                        help="Clean and create demo adventure data")
    args = parser.parse_args()

    # Handle --demo: init storage and populate, then continue to dev server
    if args.demo or args.data_dir:
        from backend import storage
        data_dir = args.data_dir or Path("data")
        storage.init_storage(data_dir)
        if args.demo:
            from backend.demo import create_demo_data
            create_demo_data()

    # Build env for subprocesses so backend picks up the same data dir
    env = os.environ.copy()
    if args.data_dir:
        env["DATA_DIR"] = str(args.data_dir.resolve())

    procs: list[subprocess.Popen] = []

    def shutdown(*_):
        print("\nShutting down...")
        for p in procs:
            p.terminate()
        for p in procs:
            p.wait()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    print(f"Starting backend on http://localhost:{BACKEND_PORT} ...")
    procs.append(subprocess.Popen(
        ["uv", "run", "uvicorn", "backend.app:app", "--reload", "--host", HOST, "--port", BACKEND_PORT],
        cwd=ROOT, env=env,
    ))

    print(f"Starting frontend on http://localhost:{FRONTEND_PORT} ...")
    procs.append(subprocess.Popen(
        ["bun", "run", "dev", "--port", FRONTEND_PORT],
        cwd=ROOT / "frontend", env=env,
    ))

    for p in procs:
        p.wait()


if __name__ == "__main__":
    main()
