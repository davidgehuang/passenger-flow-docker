#!/usr/bin/env bash
set -euo pipefail
ip="$(python3.12 -c 'import json; print(json.load(open("/etc/passenger-flow/config.json"))["app_ip"])')"
openssl x509 -checkend 86400 -noout -in "/etc/letsencrypt/live/$ip/fullchain.pem" ||
  { logger -p daemon.err 'Passenger Flow TLS证书剩余不足24小时或读取失败'; exit 1; }
