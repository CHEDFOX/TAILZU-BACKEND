"""Tasks that exist so the tests can see what a job cannot do from the inside. Never reachable from the HTTP side."""
from __future__ import annotations

import socket


def run(args: dict):
    what = args.get("what")
    if what == "network":
        try:
            socket.create_connection(("93.184.216.34", 80), timeout=2)
            return {"connected": True}
        except OSError as e:
            return {"connected": False, "error": type(e).__name__}
    if what == "dns":
        try:
            socket.getaddrinfo("example.com", 80)
            return {"resolved": True}
        except OSError as e:
            return {"resolved": False, "error": type(e).__name__}
    if what == "memory":
        blob = bytearray(int(args["mb"]) * 1024 * 1024)
        return {"allocated": len(blob)}
    if what == "sleep":
        import time

        time.sleep(float(args["seconds"]))
        return {"slept": True}
    if what == "spawn_sleeper":
        import subprocess

        subprocess.Popen(["sleep", "30"])
        import time

        time.sleep(30)
        return {}
    return {}
