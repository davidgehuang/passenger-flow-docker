#!/usr/bin/env bash
set -euo pipefail
[[ $EUID == 0 ]] || exit 1
cd "$(dirname "$0")"
ip="$(python3.12 -c 'import json,ipaddress; c=json.load(open("/etc/passenger-flow/config.json")); print(ipaddress.IPv4Address(c["app_ip"]))')"
read -r -p '证书联系邮箱：' email
[[ "$email" == *@* ]] || { echo '邮箱无效'; exit 1; }
backup="/var/lib/passenger-flow/backups/nginx-$(date +%Y%m%d-%H%M%S)"
install -d -m 700 "$backup"
cp -a /etc/nginx "$backup/"
restore_nginx() {
  # 只移除本脚本安装的单个文件，避免原来没有该文件时恢复后仍残留。
  rm -f -- /etc/nginx/conf.d/passenger-flow.conf
  cp -a "$backup/nginx/." /etc/nginx/
}
# 专用实验主机才允许替换主配置。备份后生成明确的http入口，避免默认server冲突。
cat >/etc/nginx/nginx.conf <<'NGINX'
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log;
pid /run/nginx.pid;
include /usr/share/nginx/modules/*.conf;
events { worker_connections 1024; }
http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    access_log /var/log/nginx/access.log;
    sendfile on;
    include /etc/nginx/conf.d/*.conf;
}
NGINX
install -m 644 nginx-http.conf /etc/nginx/conf.d/passenger-flow.conf
if ! nginx -t; then
  restore_nginx; exit 1
fi
systemctl enable --now nginx
systemctl reload nginx
cb=/opt/passenger-certbot/bin/certbot
# staging与正式证书目录隔离，防止把测试证书部署成正式证书。
"$cb" certonly --staging --non-interactive --agree-tos -m "$email" \
  --preferred-profile shortlived --webroot -w /var/www/passenger-acme --ip-address "$ip" \
  --config-dir /var/lib/passenger-flow/acme-staging/config \
  --work-dir /var/lib/passenger-flow/acme-staging/work --logs-dir /var/lib/passenger-flow/acme-staging/logs
"$cb" certonly --non-interactive --agree-tos -m "$email" \
  --preferred-profile shortlived --webroot -w /var/www/passenger-acme --ip-address "$ip"
sed "s/__IP__/$ip/g" nginx-https.conf >/etc/nginx/conf.d/passenger-flow.conf
restorecon -Rv /etc/nginx /etc/letsencrypt
if ! nginx -t; then restore_nginx; systemctl reload nginx; exit 1; fi
systemctl reload nginx
install -m 644 passenger-cert-renew.service passenger-cert-renew.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now passenger-cert-renew.timer
"$cb" renew --dry-run --run-deploy-hooks \
  --deploy-hook '/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx'
./check-certificate.sh
curl --fail --silent --show-error --max-time 15 "https://$ip/live"
echo "IP HTTPS及测试续期完成。备份：$backup"
