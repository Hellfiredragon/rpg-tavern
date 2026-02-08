"""RPG Tavern — dev launcher. Starts backend and frontend in watch mode."""

import signal
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent


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

    print("Starting backend on http://localhost:13013 ...")
    procs.append(subprocess.Popen(
        ["uv", "run", "uvicorn", "backend.app:app", "--reload", "--host", "0.0.0.0", "--port", "13013"],
        cwd=ROOT,
    ))

    print("Starting frontend on http://localhost:13014 ...")
    procs.append(subprocess.Popen(
        ["bun", "run", "dev"],
        cwd=ROOT / "frontend",
    ))

    for p in procs:
        p.wait()


if __name__ == "__main__":
    main()
