"""RPG Tavern — dev launcher. Starts backend and frontend in watch mode."""

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
        cwd=ROOT,
    ))

    print(f"Starting frontend on http://localhost:{FRONTEND_PORT} ...")
    procs.append(subprocess.Popen(
        ["bun", "run", "dev", "--port", FRONTEND_PORT],
        cwd=ROOT / "frontend",
    ))

    for p in procs:
        p.wait()


if __name__ == "__main__":
    main()
