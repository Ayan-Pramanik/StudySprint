#!/usr/bin/env bash
# Installs the StudySprint nginx site. Run: sudo deploy/nginx/install.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "Run with sudo: sudo $0" >&2
    exit 1
fi

here="$(cd "$(dirname "$0")" && pwd)"

install -m 644 "$here/studysprint.conf" /etc/nginx/sites-available/studysprint
ln -sf /etc/nginx/sites-available/studysprint /etc/nginx/sites-enabled/studysprint

# The stock site also claims default_server on port 80. Only the symlink is removed;
# re-enable with: sudo ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/
if [ -L /etc/nginx/sites-enabled/default ]; then
    rm /etc/nginx/sites-enabled/default
    echo "Disabled the default nginx site (still in /etc/nginx/sites-available/default)."
fi

nginx -t
systemctl enable --now nginx
systemctl reload nginx

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
    ufw allow 80/tcp
    echo "Opened port 80 in ufw."
fi

echo
echo "nginx is serving StudySprint on port 80. Keep 'npm start' running, then open:"
for ip in $(hostname -I); do
    case "$ip" in *:*) ;; *) echo "  http://$ip/" ;; esac
done
