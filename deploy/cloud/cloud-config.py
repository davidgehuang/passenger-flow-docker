#!/usr/bin/env python3
"""仅在服务器交互读取密码；raw env_file避免Compose再次插值。"""
import argparse
import getpass
import ipaddress
import json
import os
import re
import secrets
from pathlib import Path


def check_config(c):
    if c.get("platform") not in ("AWS", "TENCENT"):
        raise ValueError("platform只能为AWS或TENCENT")
    for k in ("db_host", "app_ip"):
        if not re.fullmatch(r"[A-Za-z0-9.-]+", str(c.get(k, ""))):
            raise ValueError(k + "格式无效")
    ipaddress.IPv4Address(c["app_ip"])
    for k in ("db_name", "db_user"):
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", str(c.get(k, ""))):
            raise ValueError(k + "格式无效")
    if len(c["db_user"]) > 32:
        raise ValueError("MySQL业务账号最多32字符")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/@:-]+@sha256:[a-f0-9]{64}", c.get("image", "")):
        raise ValueError("必须使用完整仓库地址@sha256摘要")
    if not c.get("app_user") or ":" in c["app_user"]:
        raise ValueError("网页账号不能为空或含冒号")
    for k in ("app_user", "db_password", "app_password"):
        if not c.get(k) or any(x in c[k] for x in ("\r", "\n", "\0")):
            raise ValueError(k + "不能为空或包含换行/NUL")
    if type(c.get("readonly")) is not bool:
        raise ValueError("readonly必须是布尔值")
    return c


def env_text(c):
    check_config(c)
    values = {
        "NODE_ENV": "production", "CONTAINER_RUNTIME": "true", "BIND_HOST": "0.0.0.0",
        "PORT": "3030", "APP_ENV_NAME": c["platform"], "ENV_FILE": "/nonexistent",
        "DB_HOST": c["db_host"], "DB_PORT": "3306", "DB_NAME": c["db_name"],
        "DB_USER": c["db_user"], "DB_PASSWORD": c["db_password"], "DB_SSL": "true",
        "DB_SSL_CA": "/run/db-ca.pem", "DB_CONNECTION_LIMIT": "5", "DB_TIME_ZONE": "+08:00",
        "DB_SSL_VERIFY_IDENTITY": "true",
        "APP_AUTH_USER": c["app_user"], "APP_AUTH_PASSWORD": c["app_password"],
        "AUTO_INIT_SCHEMA": "false", "SEED_DEMO_DATA": "false",
        "MAINTENANCE_MODE": str(c["readonly"]).lower(), "DB_READ_ONLY": str(c["readonly"]).lower(),
        "ENABLE_CONTINUOUS_WORKLOAD": "false", "REPORTS_DIR": "/reports",
        "MAINTENANCE_FILE": "/tmp/passenger-flow-maintenance",
    }
    return "".join(k + "=" + v + "\n" for k, v in values.items())


def save(c, directory):
    check_config(c)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name, body in (("config.json", json.dumps(c, ensure_ascii=False, indent=2)),
                       ("app.env", env_text(c)), ("deploy.env", "APP_IMAGE=" + c["image"] + "\n")):
        tmp = directory / (name + ".tmp")
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            if os.name != "nt":
                os.chmod(tmp, 0o600)
            f.write(body)
        os.replace(tmp, directory / name)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("action", choices=("configure", "render", "readonly", "writable"))
    p.add_argument("--outputs", type=Path)
    p.add_argument("--directory", type=Path, default=Path("/etc/passenger-flow"))
    a = p.parse_args()
    target = a.directory / "config.json"
    if a.action == "configure":
        if target.exists():
            raise ValueError("配置已存在；更新镜像使用release，修改账号需备份后人工编辑config.json，再render")
        if not a.outputs:
            raise ValueError("需要Terraform的脱敏deployment输出文件")
        c = json.loads(a.outputs.read_text(encoding="utf-8-sig"))
        c["image"] = input("镜像完整地址（仓库@sha256摘要）：").strip()
        c["db_user"] = input("APP数据库账号 [passenger_app]：").strip() or "passenger_app"
        c["app_user"] = input("网页账号 [cloud-admin]：").strip() or "cloud-admin"
        for k, label in (("db_password", "数据库业务密码"), ("app_password", "网页密码")):
            c[k] = getpass.getpass(label + "（不回显；留空生成）：") or secrets.token_urlsafe(24)
        c["readonly"] = c["platform"] == "TENCENT"
    else:
        c = json.loads(target.read_text(encoding="utf-8"))
        if a.action in ("readonly", "writable"):
            c["readonly"] = a.action == "readonly"
    save(c, a.directory)
    print("配置已保存；查看密码：sudo less /etc/passenger-flow/config.json（勿截图或上传）。")
    print("数据库：", c["db_name"], "账号：", c["db_user"], "地址：", c["db_host"])


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError) as e:
        print("配置失败：", str(e))
        raise SystemExit(1)
