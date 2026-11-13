"""The worker never takes the server's database, Supabase or payment keys, even when started with the server's whole .env."""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_the_servers_database_and_payment_keys_never_reach_the_engine():
    env = dict(os.environ, DATABASE_URL="postgres://tailzu", SUPABASE_URL="https://tailzu.supabase.co",
               SUPABASE_SERVICE_KEY="service", SUPABASE_JWT_SECRET="jwt", RAZORPAY_KEY_SECRET="pay",
               REVENUECAT_API_KEY="rc", OPENROUTER_API_KEY="or-key")
    probe = ("import json, os, server.config\n"
             "from app.core.config import settings as s\n"
             "print(json.dumps({'env': sorted(n for n in os.environ if n.startswith(server.config.NOT_THE_WORKERS)),\n"
             "  'db': s.DATABASE_URL, 'supabase': [s.SUPABASE_URL, s.SUPABASE_SERVICE_KEY, s.SUPABASE_JWT_SECRET],\n"
             "  'pay': [s.RAZORPAY_KEY_SECRET, s.REVENUECAT_API_KEY], 'models': s.OPENROUTER_API_KEY}))")
    out = subprocess.run([sys.executable, "-c", probe], cwd=ROOT, env=env, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-2000:]
    got = json.loads(out.stdout.strip().splitlines()[-1])
    assert got["env"] == []
    assert not got["db"] and not any(got["supabase"]) and not any(got["pay"])
    assert got["models"] == "or-key"                  # what it does use still arrives
