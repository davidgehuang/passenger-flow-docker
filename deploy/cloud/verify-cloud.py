#!/usr/bin/env python3
import base64
import json
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request


def main():
    c = json.load(open("/etc/passenger-flow/config.json", encoding="utf-8"))
    token = base64.b64encode((c["app_user"] + ":" + c["app_password"]).encode()).decode()
    checks = []
    for base in ("http://127.0.0.1:3030", "https://" + c["app_ip"]):
        for path in ("/live", "/health", "/", "/stores", "/devices", "/flow-events", "/migration-lab", "/migration-check", "/system-health", "/metrics"):
            start = time.monotonic()
            req = urllib.request.Request(base + path, headers={"Authorization": "Basic " + token})
            with urllib.request.urlopen(req, timeout=120, context=ssl.create_default_context()) as r:
                data = r.read()
                if r.status != 200:
                    raise ValueError("HTTP状态异常")
                if path == "/health" and json.loads(data).get("database") != "UP":
                    raise ValueError("数据库健康检查失败")
            checks.append({"path": path, "https": base.startswith("https"), "seconds": round(time.monotonic()-start, 3)})
    try:
        urllib.request.urlopen("https://" + c["app_ip"] + "/", timeout=15)
        raise ValueError("未登录首页应拒绝")
    except urllib.error.HTTPError as e:
        if e.code != 401:
            raise
    # /health只证明连通性；额外检查APP业务账号登录与TLS，参数不含密码。
    subprocess.run(["docker", "compose", "-p", "passenger-flow-cloud", "--env-file",
                    "/etc/passenger-flow/deploy.env", "-f", "/opt/passenger-flow-cloud/compose.yaml",
                    "exec", "-T", "app", "node", "scripts/cloud-db.js", "verify"], check=True)
    print(json.dumps({"status": "PASS", "database": c["db_name"], "user": c["db_user"], "checks": checks}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # 不打印携带认证URL、连接参数或密码的异常详情。
        print("云端验证失败，类型：" + type(e).__name__, file=sys.stderr)
        sys.exit(1)
