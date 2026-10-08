#!/usr/bin/env bash
set -euo pipefail
# 无密码；只安装运维入口，完整应用准备由setup-rocky9.sh完成。
# shellcheck source=/dev/null
source /etc/os-release
[[ "$ID" == rocky && "$VERSION_ID" == 9* ]] || exit 1
dnf -y install curl ca-certificates
curl --fail --location --proto '=https' --tlsv1.2 \
  https://s3.ap-east-1.amazonaws.com/amazon-ssm-ap-east-1/latest/linux_amd64/amazon-ssm-agent.rpm \
  -o /var/tmp/amazon-ssm-agent.rpm
dnf -y install /var/tmp/amazon-ssm-agent.rpm
systemctl enable --now amazon-ssm-agent
