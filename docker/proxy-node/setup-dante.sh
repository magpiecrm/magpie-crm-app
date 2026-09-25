#!/usr/bin/env bash
# Turns a fresh Ubuntu/Debian server into a SOCKS5 proxy for email
# verification (Dante). Only the IP that runs Reacher may use it, only for
# outbound SMTP (port 25), with a username and password.
#
#   sudo ALLOW_FROM=<ip that runs Reacher> PROXY_USER=reacher PROXY_PASS='<strong password>' \
#     bash setup-dante.sh
#
# Then add the proxy in Settings → Prospecting (host = this server's IP,
# port 1080, same username/password) and run "Test verification".
# See docs/proxies.md for reverse DNS (PTR) and IP reputation.
set -euo pipefail

: "${ALLOW_FROM:?Set ALLOW_FROM to the public IP that Reacher connects from}"
: "${PROXY_USER:?Set PROXY_USER}"
: "${PROXY_PASS:?Set PROXY_PASS}"
PORT="${PORT:-1080}"

if [[ $EUID -ne 0 ]]; then echo "Run as root (sudo)." >&2; exit 1; fi

echo "==> Checking outbound port 25 (many cloud providers block it by default)"
if timeout 8 bash -c '</dev/tcp/gmail-smtp-in.l.google.com/25' 2>/dev/null; then
  echo "    port 25 is open"
else
  echo "    WARNING: outbound port 25 looks blocked on this server. Ask your provider to unblock it," >&2
  echo "    otherwise verification through this proxy will time out." >&2
fi

echo "==> Installing Dante and ufw"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq dante-server ufw >/dev/null

IFACE="$(ip route get 1.1.1.1 | awk '{for (i = 1; i <= NF; i++) if ($i == "dev") { print $(i + 1); exit }}')"

echo "==> Creating proxy user '$PROXY_USER' (no shell, no home)"
id "$PROXY_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$PROXY_USER"
echo "$PROXY_USER:$PROXY_PASS" | chpasswd

echo "==> Writing /etc/danted.conf"
cat > /etc/danted.conf <<CONF
logoutput: syslog
internal: 0.0.0.0 port = $PORT
external: $IFACE
socksmethod: username
user.privileged: root
user.unprivileged: nobody

# Only the Reacher host may connect at all.
client pass { from: $ALLOW_FROM/32 to: 0.0.0.0/0 }
client block { from: 0.0.0.0/0 to: 0.0.0.0/0 }

# And only to SMTP (port 25); this is not a general-purpose proxy.
socks pass { from: $ALLOW_FROM/32 to: 0.0.0.0/0 port = 25 command: connect }
socks block { from: 0.0.0.0/0 to: 0.0.0.0/0 }
CONF

echo "==> Firewall: SSH, plus port $PORT from $ALLOW_FROM only"
ufw allow OpenSSH >/dev/null
ufw allow from "$ALLOW_FROM" to any port "$PORT" proto tcp >/dev/null
ufw --force enable >/dev/null

systemctl enable danted >/dev/null 2>&1
systemctl restart danted
sleep 1
systemctl is-active --quiet danted && echo "==> Dante is running on port $PORT" || { echo "Dante failed to start; see: journalctl -u danted" >&2; exit 1; }

PUBLIC_IP="$(curl -s -4 https://ifconfig.me || true)"
echo
echo "Done. In Settings → Prospecting add: host ${PUBLIC_IP:-<this server IP>}, port $PORT, user $PROXY_USER."
echo "Next: set this IP's reverse DNS (PTR) to a hostname you control (see docs/proxies.md)."
