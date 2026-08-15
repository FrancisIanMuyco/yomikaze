#!/usr/bin/env python3
"""logrun.py — run a command and save its output to a log file.

Usage:
  python logrun.py <logfile> -- <command...>

Runs the command, streams its output to the console (so nothing is hidden)
AND appends the same output to <logfile>. Returns the command's exit code.

Used by yomikaze.bat so every scrape run leaves a record in scraper/logs/.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path


def main() -> int:
    # Our own console may be cp1252 — replace (don't crash) on unicode chars
    # that the console can't encode, e.g. Japanese titles.
    try:
        sys.stdout.reconfigure(errors="replace")
        sys.stderr.reconfigure(errors="replace")
    except Exception:
        pass
    args = sys.argv[1:]
    if len(args) < 3 or "--" not in args:
        print("Usage: python logrun.py <logfile> -- <command...>", file=sys.stderr)
        return 2
    sep = args.index("--")
    logfile = Path(args[0])
    command = args[sep + 1 :]

    logfile.parent.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    header = f"\n===== {stamp} :: {' '.join(command)} =====\n"
    with open(logfile, "a", encoding="utf-8", errors="replace") as log:
        log.write(header)
        env = dict(os.environ)
        env["PYTHONIOENCODING"] = "utf-8"   # unicode titles must not crash the child
        env["PYTHONUNBUFFERED"] = "1"       # stream output live instead of block-buffering
        proc = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env=env,
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            print(line, end="", flush=True)
            log.write(line)
        proc.wait()
        log.write(f"===== exit code: {proc.returncode} =====\n")
    print(f"\n[log] saved -> {logfile}")
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
