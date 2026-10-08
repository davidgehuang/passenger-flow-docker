#!/usr/bin/env bash
set -euo pipefail
[[ $EUID == 0 ]] || exit 1
umask 077
case "${1:-}" in
  AWS)
    curl --fail --location --proto '=https' --tlsv1.2 \
      https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
      -o /etc/passenger-flow/db-ca.pem.new
    ;;
  TENCENT)
    cp -- "${2:?请提供TencentDB下载的CA文件}" /etc/passenger-flow/db-ca.pem.new
    ;;
  *) echo '用法：install-ca.sh AWS | TENCENT CA路径'; exit 1 ;;
esac
openssl crl2pkcs7 -nocrl -certfile /etc/passenger-flow/db-ca.pem.new |
  openssl pkcs7 -print_certs -noout >/dev/null
chmod 644 /etc/passenger-flow/db-ca.pem.new
mv /etc/passenger-flow/db-ca.pem.new /etc/passenger-flow/db-ca.pem
echo 'CA已安装；不会关闭证书校验。'
