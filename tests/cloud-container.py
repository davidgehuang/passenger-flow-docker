"""隔离验证云端APP契约；不创建云资源，不使用用户配置或旧数据卷。

python tests/cloud-container.py
需要Docker Desktop Linux引擎。RDS存储过程在独立MySQL中为测试桩，
不能据此宣称RDS、Rocky宿主机、证书签发或DTS已经验收。
"""
import base64
import importlib.util
import json
import os
import re
import secrets
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MYSQL = "mysql:8.4@sha256:6ea90827b1100f8f2ae306a539f86d2c264a26ed435a2a9f75551dd5c3aeb242"
PROJECT = "pf-cloud-check-" + time.strftime("%Y%m%d%H%M%S")
DIRECTORY = ROOT / ".cloud-local" / PROJECT
REPORT = {"project": PROJECT, "scope": "Docker Desktop MySQL8.4/TLS/cloud APP",
          "rdsProcedures": "test stub only", "checks": [], "status": "RUNNING"}
ENV = dict(os.environ)
for key in list(ENV):
    if key.startswith(("DB_", "APP_", "MYSQL_", "COMPOSE_")) or key in ("ENV_FILE", "MAINTENANCE_MODE"):
        ENV.pop(key)


def docker(*args, env=None, stdin=None, timeout=300):
    result = subprocess.run(["docker", *args], cwd=ROOT, env=env or ENV, input=stdin,
                            text=True, encoding="utf-8", errors="replace", capture_output=True, timeout=timeout)
    if result.returncode:
        # 永不把完整Docker配置、命令或数据库错误输出到测试日志。
        error = RuntimeError("DOCKER_COMMAND_FAILED: " + (args[0] if args else "unknown"))
        match = re.search(r"云数据库操作失败：([A-Z0-9_]+)", result.stderr)
        error.code = match.group(1) if match else None
        raise error
    return result.stdout


def compose(*args, env=None):
    return docker("compose", "-p", PROJECT, "-f", str(DIRECTORY / "compose.yaml"), *args, env=env)


def note(name, **data):
    REPORT["checks"].append({"name": name, "status": "PASS", **data})
    print("PASS " + name, flush=True)


def request(path, auth=True):
    headers = {}
    if auth:
        headers["Authorization"] = "Basic " + base64.b64encode(
            (CONFIG["app_user"] + ":" + CONFIG["app_password"]).encode()).decode()
    req = urllib.request.Request("http://127.0.0.1:3032" + path, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()


CONFIG = dict(platform="AWS", app_ip="127.0.0.1", db_host="db", db_name="passenger_flow_codex",
              db_user="passenger_app", db_password="Test$# '\"\\ space-" + secrets.token_urlsafe(12),
              app_user="cloud-tester", app_password="Web$# '\"\\ space-" + secrets.token_urlsafe(12),
              image="example.test/cloud@sha256:" + "a"*64, readonly=False)
ROOT_PASSWORD = secrets.token_urlsafe(24)
ENV.update(MYSQL_PWD=ROOT_PASSWORD, DB_ADMIN_USER="root",
           DB_ADMIN_PASSWORD=ROOT_PASSWORD, DTS_PASSWORD=secrets.token_urlsafe(24))


def sql(body):
    return compose("exec", "-T", "-e", "MYSQL_PWD", "db", "mysql", "-uroot", "-N", "-B") if not body else docker(
        "compose", "-p", PROJECT, "-f", str(DIRECTORY / "compose.yaml"), "exec", "-T", "-e",
        "MYSQL_PWD", "db", "mysql", "-uroot", "-N", "-B", stdin=body)


def main():
    DIRECTORY.mkdir(parents=True, exist_ok=False)
    before = docker("ps", "-aq").split()
    image = PROJECT + ":test"
    created = False
    try:
        docker("build", "--platform", "linux/amd64", "-t", image, str(ROOT), timeout=900)
        note("current source image build")
        cert = DIRECTORY / "certs"
        cert.mkdir()
        cert_commands = """
openssl req -x509 -newkey rsa:2048 -nodes -keyout /certs/ca-key.pem -out /certs/ca.pem -days 2 -subj /CN=IsolatedTestCA
openssl req -newkey rsa:2048 -nodes -keyout /certs/server-key.pem -out /certs/server.csr -subj /CN=db
printf 'subjectAltName=DNS:db,IP:127.0.0.1\\nextendedKeyUsage=serverAuth\\n' >/certs/ext.cnf
openssl x509 -req -in /certs/server.csr -CA /certs/ca.pem -CAkey /certs/ca-key.pem -CAcreateserial -out /certs/server-cert.pem -days 2 -extfile /certs/ext.cnf
chmod 644 /certs/*.pem
"""
        docker("run", "--rm", "--user", "0", "--entrypoint", "bash", "-v", str(cert) + ":/certs",
               MYSQL, "-euc", cert_commands)
        spec = importlib.util.spec_from_file_location("cfg", ROOT / "deploy/cloud/cloud-config.py")
        cfg = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cfg)
        cfg.save(CONFIG, DIRECTORY / "config")
        # JSON是合法YAML，避免Windows路径和特殊字符经过第二次解析。
        spec_data = {"services": {
            "db": {"image": MYSQL, "environment": {"MYSQL_ROOT_PASSWORD": ROOT_PASSWORD, "MYSQL_ROOT_HOST": "%"},
                   "command": ["--require-secure-transport=ON", "--ssl-ca=/certs/ca.pem",
                               "--ssl-cert=/certs/server-cert.pem", "--ssl-key=/certs/server-key.pem"],
                   "volumes": [str(cert) + ":/certs:ro", "data:/var/lib/mysql"],
                   "networks": {"default": {"aliases": ["wrong-db"]}}},
            "app": {"image": image, "env_file": [{"path": str(DIRECTORY / "config/app.env"), "format": "raw"}],
                    "ports": ["127.0.0.1:3032:3030"],
                    "volumes": [str(cert / "ca.pem") + ":/run/db-ca.pem:ro"],
                    "read_only": True, "tmpfs": ["/tmp:uid=1000,gid=1000,mode=1777", "/reports:uid=1000,gid=1000"],
                    "cap_drop": ["ALL"], "security_opt": ["no-new-privileges:true"], "init": True,
                    "healthcheck": {"test": ["CMD", "node", "scripts/container-health.js"],
                                    "interval": "2s", "timeout": "5s", "retries": 20, "start_period": "10s"}}
        }, "volumes": {"data": {}}}
        (DIRECTORY / "compose.yaml").write_text(json.dumps(spec_data), encoding="utf-8")
        compose("up", "-d", "db")
        created = True
        end = time.monotonic() + 150
        while True:
            try:
                sql("SELECT 1;")
                break
            except RuntimeError:
                if time.monotonic() > end:
                    raise RuntimeError("MYSQL_START_TIMEOUT")
                time.sleep(2)
        REPORT["mysqlVersion"] = sql("SELECT VERSION();").strip()
        sql("CREATE PROCEDURE mysql.rds_set_configuration(IN param_name VARCHAR(255), IN param_value INT) SELECT 1;")
        compose("run", "--rm", "--no-deps", "-e", "DB_ADMIN_USER", "-e", "DB_ADMIN_PASSWORD",
                "-e", "DTS_PASSWORD", "app", "node", "scripts/cloud-db.js", "init-source")
        counts = sql("SELECT (SELECT COUNT(*) FROM passenger_flow_codex.stores),"
                     "(SELECT COUNT(*) FROM passenger_flow_codex.devices);").strip()
        assert counts == "5\t10"
        note("fresh schema and demo base data", stores=5, devices=10)
        compose("run", "--rm", "--no-deps", "app", "node", "scripts/cloud-db.js", "verify")
        note("business login over verified TLS with special-character password")
        for key, value, label in (
            ("DB_HOST", "wrong-db", "TLS certificate identity mismatch rejected"),
            ("DB_SSL_CA", "/etc/ssl/cert.pem", "untrusted database CA rejected"),
        ):
            try:
                compose("run", "--rm", "--no-deps", "-e", key, "app", "node", "scripts/cloud-db.js", "verify",
                        env=dict(ENV, **{key: value}))
            except RuntimeError as error:
                assert error.code in ("ERR_TLS_CERT_ALTNAME_INVALID", "SELF_SIGNED_CERT_IN_CHAIN",
                                      "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "HANDSHAKE_SSL_ERROR",
                                      "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"), error.code
                note(label, errorCode=error.code)
            else:
                raise AssertionError(label + " failed")
        # 密码错时必须返回非零；不读取现有环境。
        wrong_env = dict(ENV, DB_PASSWORD="definitely-wrong-test-password")
        try:
            compose("run", "--rm", "--no-deps", "-e", "DB_PASSWORD", "app", "node", "scripts/cloud-db.js", "verify", env=wrong_env)
        except RuntimeError as error:
            assert error.code == "ER_ACCESS_DENIED_ERROR", error.code
            note("wrong database password rejected", errorCode=error.code)
        else:
            raise AssertionError("wrong password accepted")
        compose("up", "-d", "--wait", "--wait-timeout", "120", "app")
        assert request("/", False)[0] == 401
        note("anonymous page rejected")
        paths = ["/", "/stores", "/devices", "/flow-events", "/migration-lab", "/migration-check", "/system-health"]
        for path in paths:
            started = time.monotonic()
            assert request(path)[0] == 200
            note("authenticated " + path, elapsedMs=round((time.monotonic()-started)*1000))
        compose("exec", "-T", "app", "node", "scripts/generate-test-data.js", "--rows", "200", "--days", "1")
        row_count = int(sql("SELECT COUNT(*) FROM passenger_flow_codex.flow_events;").strip())
        assert row_count == 200
        note("small business write", flowRows=row_count)
        browser_env = dict(ENV, CLOUD_TEST_CONFIG=str(DIRECTORY / "config/config.json"))
        result = subprocess.run(["node", "tests/cloud-browser.js"], cwd=ROOT, env=browser_env,
                                capture_output=True, text=True, encoding="utf-8", timeout=150)
        if result.returncode:
            raise RuntimeError("ISOLATED_BROWSER_FAILED")
        note("Edge browser seven pages and local assets")
        row_count = int(sql("SELECT COUNT(*) FROM passenger_flow_codex.flow_events;").strip())
        assert row_count == 201
        note("authenticated same-origin POST and rejected cross-origin POST")
        compose("up", "-d", "--force-recreate", "--wait", "--wait-timeout", "120", "app")
        assert int(sql("SELECT COUNT(*) FROM passenger_flow_codex.flow_events;").strip()) == row_count
        assert request("/")[0] == 200
        note("APP recreation preserves login and database data")
        CONFIG["readonly"] = True
        cfg.save(CONFIG, DIRECTORY / "config")
        compose("up", "-d", "--force-recreate", "--wait", "--wait-timeout", "120", "app")
        try:
            compose("exec", "-T", "app", "node", "scripts/generate-test-data.js", "--rows", "1", "--days", "1")
        except RuntimeError:
            note("target read-only mode rejects generation")
        else:
            raise AssertionError("readonly write accepted")
        assert request("/")[0] == 200
        REPORT["status"] = "PASS"
    except Exception as error:
        REPORT["status"] = "FAIL"
        REPORT["error"] = str(error) if isinstance(error, (AssertionError, RuntimeError)) else type(error).__name__
        raise
    finally:
        if created:
            # 仅清理由本脚本独立项目创建的容器和卷，不触碰已有环境。
            compose("down", "--volumes", "--remove-orphans")
        after = docker("ps", "-aq").split()
        REPORT["originalContainersPreserved"] = set(before).issubset(set(after))
        REPORT["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        output = ROOT / "reports/cloud-container"
        output.mkdir(parents=True, exist_ok=True)
        (output / "result.json").write_text(json.dumps(REPORT, ensure_ascii=False, indent=2), encoding="utf-8")
        print("Result: " + REPORT["status"] + "; reports/cloud-container/result.json")


if __name__ == "__main__":
    main()
