#!/bin/bash
# Connect a GitHub Actions runner to a NordVPN server in Spain over OpenVPN, so the portal
# sees a Spanish IP. Needs NORD_USER / NORD_PASS = NordVPN *service credentials* (not the
# account email/password). Untested until those secrets exist.
set -euo pipefail

sudo apt-get install -y -qq openvpn > /dev/null

# Least-loaded Spanish server that supports OpenVPN TCP (country_id 202 = Spain).
api='https://api.nordvpn.com/v1/servers/recommendations?filters[country_id]=202&filters[servers_technologies][identifier]=openvpn_tcp&limit=1'
host=$(curl -sfg "$api" | jq -r '.[0].hostname')
[ -n "$host" ] && [ "$host" != "null" ] || { echo "No NordVPN Spain server returned"; exit 1; }
echo "NordVPN server: $host"

curl -sf -o "$RUNNER_TEMP/nord.ovpn" "https://downloads.nordcdn.com/configs/files/ovpn_tcp/servers/$host.tcp.ovpn"
umask 077
printf '%s\n%s\n' "$NORD_USER" "$NORD_PASS" > "$RUNNER_TEMP/nord.auth"

sudo openvpn --config "$RUNNER_TEMP/nord.ovpn" --auth-user-pass "$RUNNER_TEMP/nord.auth" \
  --daemon --log "$RUNNER_TEMP/openvpn.log"

for i in $(seq 1 30); do
  if sudo grep -q 'Initialization Sequence Completed' "$RUNNER_TEMP/openvpn.log"; then
    country=$(curl -sf --max-time 10 https://ipinfo.io/country || echo '?')
    echo "VPN up, egress country: $country"
    echo "MONITOR_HOST=gha-nord" >> "$GITHUB_ENV"
    [ "$country" = "ES" ] || { echo "Egress is not Spain"; exit 1; }
    exit 0
  fi
  if sudo grep -q 'AUTH_FAILED' "$RUNNER_TEMP/openvpn.log"; then
    echo "NordVPN rejected the credentials (use the service credentials from the Nord dashboard)"; exit 1
  fi
  sleep 2
done
echo "VPN did not come up in 60s"
sudo tail -n 20 "$RUNNER_TEMP/openvpn.log" | grep -v -i auth || true
exit 1
