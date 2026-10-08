#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $EUID == 0 ]] || { echo '请用sudo执行'; exit 1; }
cd "$(dirname "$0")"
action="${1:-}"
cfg() { python3.12 -c 'import json,sys; print(json.load(open("/etc/passenger-flow/config.json"))[sys.argv[1]])' "$1"; }
compose() { docker compose -p passenger-flow-cloud --env-file /etc/passenger-flow/deploy.env -f "$PWD/compose.yaml" "$@"; }
backup() {
  b="/var/lib/passenger-flow/backups/release-$(date +%Y%m%d-%H%M%S)-$$"
  install -d -m 700 "$b"; cp -a /etc/passenger-flow/. "$b/"
  printf '%s\n' "$b" >/var/lib/passenger-flow/previous-release
}
pull() {
  registry="$(cfg image)"; registry="${registry%%/*}"
  if [[ "$(cfg platform)" == AWS ]]; then
    aws ecr get-login-password --region ap-east-1 | docker login --username AWS --password-stdin "$registry"
  fi
  # Tencent须事先由操作者通过--password-stdin登录；不写长期AWS密钥。
  docker pull "$(cfg image)"
}
case "$action" in
  configure)
    python3.12 cloud-config.py configure --outputs "${2:?需要deployment.json}"
    ;;
  init-source)
    [[ "$(cfg platform)" == AWS ]] || { echo '腾讯DTS目标禁止源库初始化'; exit 1; }
    [[ ! -e /var/lib/passenger-flow/source-initialized ]] || { echo '源库已初始化，拒绝重复管理员操作'; exit 1; }
    pull
    read -r -s -p 'RDS管理员密码（不回显）：' DB_ADMIN_PASSWORD; printf '\n'
    export DB_ADMIN_PASSWORD
    read -r -s -p 'DTS专用账号密码（不回显）：' DTS_PASSWORD; printf '\n'
    export DTS_PASSWORD
    DB_ADMIN_USER="$(cfg master_user)"; export DB_ADMIN_USER
    compose run --rm --no-deps -e DB_ADMIN_PASSWORD -e DB_ADMIN_USER -e DTS_PASSWORD \
      app node scripts/cloud-db.js init-source
    unset DB_ADMIN_PASSWORD DTS_PASSWORD
    touch /var/lib/passenger-flow/source-initialized
    ;;
  deploy)
    pull
    backup
    install -m 644 passenger-flow.service /etc/systemd/system/
    systemctl daemon-reload
    if ! systemctl enable --now passenger-flow; then
      echo '应用启动失败，配置备份已保存，请查看日志或执行rollback'; exit 1
    fi
    compose up -d --wait --wait-timeout 180
    ip="$(cfg app_ip)"
    [[ -s "/etc/letsencrypt/live/$ip/fullchain.pem" ]] || ./tls-ip.sh
    python3.12 verify-cloud.py
    ;;
  release)
    image="${2:?需要完整镜像摘要}"
    backup
    python3.12 - "$image" <<'PY'
import json,sys
from pathlib import Path
from importlib.util import spec_from_file_location,module_from_spec
s=spec_from_file_location("cfg","cloud-config.py"); m=module_from_spec(s); s.loader.exec_module(m)
c=json.load(open("/etc/passenger-flow/config.json")); c["image"]=sys.argv[1]; m.save(c,Path("/etc/passenger-flow"))
PY
    if ! pull || ! compose up -d --wait --wait-timeout 180 || ! python3.12 verify-cloud.py; then
      echo '新版本验证失败，恢复上一配置和镜像'
      cp -a "$b/." /etc/passenger-flow/
      compose up -d --wait --wait-timeout 180
      exit 1
    fi
    ;;
  rollback)
    previous="$(cat /var/lib/passenger-flow/previous-release)"
    [[ "$previous" == /var/lib/passenger-flow/backups/release-* && -d "$previous" ]] || exit 1
    cp -a "$previous/." /etc/passenger-flow/
    pull
    compose up -d --wait --wait-timeout 180
    python3.12 verify-cloud.py
    ;;
  readonly|writable)
    backup
    python3.12 cloud-config.py "$action"
    compose up -d --wait --wait-timeout 180
    ;;
  verify) python3.12 verify-cloud.py ;;
  replica-precheck)
    export DB_HOST="${2:?只读副本的DNS端点}"
    read -r -s -p 'DTS密码（不回显）：' DB_PASSWORD; printf '\n'; export DB_PASSWORD
    compose run --rm --no-deps -e DB_HOST -e DB_PASSWORD -e DB_USER=passenger_dts \
      app node scripts/cloud-db.js replica-check
    unset DB_PASSWORD
    ;;
  set-replica-retention)
    export DB_HOST="${2:?只读副本的DNS端点}"
    read -r -s -p 'RDS管理员密码（不回显）：' DB_ADMIN_PASSWORD; printf '\n'; export DB_ADMIN_PASSWORD
    DB_ADMIN_USER="$(cfg master_user)"; export DB_ADMIN_USER
    compose run --rm --no-deps -e DB_HOST -e DB_ADMIN_PASSWORD -e DB_ADMIN_USER \
      app node scripts/cloud-db.js retention
    unset DB_ADMIN_PASSWORD
    ;;
  *) echo '用法：deploy.sh configure|init-source|deploy|release|verify|rollback|readonly|writable|replica-precheck|set-replica-retention'; exit 1 ;;
esac
