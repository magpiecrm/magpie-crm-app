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
#
# Several IPs on one server (e.g. OVH Additional IPs, already added to the
# network interface): list them in EXTERNAL_IPS. Each gets its own proxy on
# its own port (PORT, PORT+1, …) that connects out from that IP, so each
# counts as a separate verification IP:
#
#   sudo EXTERNAL_IPS="203.0.113.10 203.0.113.11" ALLOW_FROM=… PROXY_USER=… PROXY_PASS=… \
#     bash setup-dante.sh
#
# DRY_RUN_DIR=<dir> only writes the Dante configs there and changes nothing
# else (no root needed), to check them.
#
# See docs/proxies.md for reverse DNS (PTR) and IP reputation.
set -euo pipefail

: "${ALLOW_FROM:?Set ALLOW_FROM to the public IP that Reacher connects from}"
: "${PROXY_USER:?Set PROXY_USER}"
PORT="${PORT:-1080}"
EXTERNAL_IPS="${EXTERNAL_IPS:-}"
DRY_RUN_DIR="${DRY_RUN_DIR:-}"

# One Dante config: listen on $2, connect out from $3.
write_conf() {
  local file="$1" port="$2" external="$3"
  cat > "$file" <<CONF
logoutput: syslog
internal: 0.0.0.0 port = $port
external: $external
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
}

if [[ -n "$DRY_RUN_DIR" ]]; then
  mkdir -p "$DRY_RUN_DIR"
  if [[ -z "$EXTERNAL_IPS" ]]; then
    write_conf "$DRY_RUN_DIR/danted.conf" "$PORT" "<this server's IPv4>"
  else
    n=0
    for ip in $EXTERNAL_IPS; do
      write_conf "$DRY_RUN_DIR/danted-$n.conf" "$((PORT + n))" "$ip"
      n=$((n + 1))
    done
  fi
  echo "Wrote Dante configs to $DRY_RUN_DIR (nothing else changed)."
  exit 0
fi

: "${PROXY_PASS:?Set PROXY_PASS}"
if [[ $EUID -ne 0 ]]; then echo "Run as root (sudo)." >&2; exit 1; fi

# Each listed IP must already be on a network interface; this script never
# changes the network configuration.
for ip in $EXTERNAL_IPS; do
  if ! [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "\"$ip\" isn't an IPv4 address." >&2; exit 1
  fi
  if ! ip -4 -o addr show | grep -qw "inet $ip"; then
    echo "$ip isn't on any network interface yet. Add it first (OVH: \"Configuring IP aliasing\" in their guides), then run this again." >&2
    exit 1
  fi
done

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

# Pin outgoing connections to an IPv4 address. Most VPSs also have IPv6, and
# mail hosts with AAAA records (Gmail) would otherwise be reached over an
# address with no reverse DNS that the health check never looks at.
MAIN_IP="$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')"

echo "==> Creating proxy user '$PROXY_USER' (no shell, no home)"
id "$PROXY_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$PROXY_USER"
echo "$PROXY_USER:$PROXY_PASS" | chpasswd

ufw allow OpenSSH >/dev/null
PUBLIC_IP="$(curl -s -4 https://ifconfig.me || true)"

if [[ -z "$EXTERNAL_IPS" ]]; then
  echo "==> Writing /etc/danted.conf"
  write_conf /etc/danted.conf "$PORT" "$MAIN_IP"
  echo "==> Firewall: SSH, plus port $PORT from $ALLOW_FROM only"
  ufw allow from "$ALLOW_FROM" to any port "$PORT" proto tcp >/dev/null
  ufw --force enable >/dev/null
  systemctl enable danted >/dev/null 2>&1
  systemctl restart danted
  sleep 1
  systemctl is-active --quiet danted && echo "==> Dante is running on port $PORT" || { echo "Dante failed to start; see: journalctl -u danted" >&2; exit 1; }
  echo
  echo "Done. In Settings → Prospecting add: host ${PUBLIC_IP:-<this server IP>}, port $PORT, user $PROXY_USER."
  echo "Next: set this IP's reverse DNS (PTR) to a hostname you control (see docs/proxies.md)."
  exit 0
fi

echo "==> One Dante per IP (danted@N)"
cat > /etc/systemd/system/danted@.service <<'UNIT'
[Unit]
Description=Dante SOCKS proxy (instance %i)
After=network-online.target
Wants=network-online.target

[Service]
Type=forking
PIDFile=/run/danted-%i.pid
ExecStart=/usr/sbin/danted -D -f /etc/danted-%i.conf -p /run/danted-%i.pid
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
# The single-IP service would hold PORT; the instances take over.
systemctl disable --now danted >/dev/null 2>&1 || true

n=0
lines=()
for ip in $EXTERNAL_IPS; do
  port=$((PORT + n))
  write_conf "/etc/danted-$n.conf" "$port" "$ip"
  ufw allow from "$ALLOW_FROM" to any port "$port" proto tcp >/dev/null
  systemctl enable "danted@$n" >/dev/null 2>&1
  systemctl restart "danted@$n"
  lines+=("  host ${PUBLIC_IP:-$MAIN_IP}, port $port, outgoing IP $ip, user $PROXY_USER")
  n=$((n + 1))
done
ufw --force enable >/dev/null
sleep 1

failed=0
for ((i = 0; i < n; i++)); do
  systemctl is-active --quiet "danted@$i" || { echo "danted@$i failed to start; see: journalctl -u danted@$i" >&2; failed=1; }
done
[[ $failed -eq 0 ]] || exit 1

echo
echo "Done: $n proxies. Add each as its own verification IP:"
printf '%s\n' "${lines[@]}"
echo "Next: set each IP's reverse DNS (PTR) to a hostname you control (see docs/proxies.md)."
