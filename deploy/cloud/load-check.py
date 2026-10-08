#!/usr/bin/env python3
"""5用户只读页面检查；不造数、不清库。"""
import argparse
import base64
import concurrent.futures
import json
import ssl
import statistics
import time
import urllib.request


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--rounds", type=int, default=2)
    a = p.parse_args()
    if not 1 <= a.rounds <= 10:
        raise ValueError("rounds只能1–10")
    c = json.load(open("/etc/passenger-flow/config.json"))
    auth = base64.b64encode((c["app_user"] + ":" + c["app_password"]).encode()).decode()
    paths = ["/", "/stores", "/devices", "/flow-events", "/migration-lab"]
    def visit(path):
        start = time.monotonic()
        try:
            req = urllib.request.Request("https://" + c["app_ip"] + path, headers={"Authorization": "Basic " + auth})
            with urllib.request.urlopen(req, timeout=120, context=ssl.create_default_context()) as r:
                r.read()
                return {"path": path, "ok": r.status == 200, "seconds": time.monotonic()-start}
        except Exception:
            return {"path": path, "ok": False, "seconds": time.monotonic()-start}
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        rows = list(pool.map(visit, paths * a.rounds))
    times = sorted(r["seconds"] for r in rows)
    errors = sum(not r["ok"] for r in rows)
    print(json.dumps({"users": 5, "requests": len(rows), "errors": errors,
                     "medianSeconds": statistics.median(times), "maxSeconds": max(times), "requestsDetail": rows,
                     "note": "页面采样，不是容量保证；同时查看数据库CPU及副本延迟"}, ensure_ascii=False))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
