#!/usr/bin/env bash
set -euo pipefail
[[ $EUID == 0 ]] || { echo '请用sudo执行'; exit 1; }
# shellcheck source=/dev/null
source /etc/os-release
[[ "$ID" == rocky && "$VERSION_ID" == 9* && "$(uname -m)" == x86_64 ]] || { echo '只支持Rocky 9 x86_64'; exit 1; }
if rpm -q podman-docker >/dev/null 2>&1; then
  echo '检测到podman-docker冲突；请管理员评估后处理，脚本不会卸载。'; exit 1
fi
dnf -y upgrade --security
dnf -y install dnf-plugins-core curl ca-certificates nginx firewalld \
  policycoreutils-python-utils chrony python3.12 python3.12-pip unzip jq
dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now chronyd docker firewalld
if [[ "${1:-AWS}" == AWS ]] && ! command -v aws >/dev/null; then
  curl --fail --location --proto '=https' --tlsv1.2 https://awscli.amazonaws.com/v2/install.sh \
    -o /var/tmp/passenger-aws-install.sh
  bash /var/tmp/passenger-aws-install.sh
  [[ -x /root/.local/bin/aws ]] && ln -s /root/.local/bin/aws /usr/local/bin/aws
  command -v aws >/dev/null || { echo 'AWS CLI安装路径未识别，请按官方指引配置'; exit 1; }
fi
docker info --format '{{.ServerVersion}}'
docker compose version
# Compose raw env_file要求2.30+；版本不足时拒绝。
v="$(docker compose version --short | sed 's/^v//')"
[[ "$(printf '%s\n' 2.30.0 "$v" | sort -V | head -n1)" == 2.30.0 ]] || { echo 'Compose须>=2.30'; exit 1; }
[[ "$(getenforce)" == Enforcing ]] || { echo '请恢复SELinux Enforcing后再部署'; exit 1; }
setsebool -P httpd_can_network_connect on
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload
install -d -m 700 /etc/passenger-flow /var/lib/passenger-flow/backups
install -d -m 755 /var/lib/passenger-flow/reports /var/www/passenger-acme
chown 1000:1000 /var/lib/passenger-flow/reports
semanage fcontext -a -t httpd_sys_content_t '/var/www/passenger-acme(/.*)?' 2>/dev/null ||
  semanage fcontext -m -t httpd_sys_content_t '/var/www/passenger-acme(/.*)?'
restorecon -Rv /var/www/passenger-acme
# 固定版本；升级需重新验证IP签发与续期，不替换系统Python。
[[ -x /opt/passenger-certbot/bin/python ]] || python3.12 -m venv /opt/passenger-certbot
/opt/passenger-certbot/bin/pip install 'certbot==5.4.0'
if dnf needs-restarting -r >/dev/null 2>&1; then
  echo 'Rocky准备完成，继续configure。'
else
  echo '安全更新要求重启。请手工重启，再执行setup并继续configure。'; exit 2
fi
