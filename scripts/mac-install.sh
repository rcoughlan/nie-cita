#!/bin/bash
# Install and start the monitor as a LaunchAgent on this Mac.
#   /bin/bash scripts/mac-install.sh
# It runs `node monitor.mjs --loop` forever in a real (headed) Chrome window that's minimised
# straight away and reused, so nothing pops up between checks. It keeps the Mac awake while
# it's on mains power (caffeinate -s), restarts it if it crashes, and stays stopped once the
# teardown date is reached (a clean exit). Logs: ~/Library/Logs/nie-cita.log
# Undo with scripts/mac-uninstall.sh.
set -e

LABEL=dev.ryancoughlan.nie-cita
REPO=$(cd "$(dirname "$0")/.." && pwd)
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGFILE="$HOME/Library/Logs/nie-cita.log"

cd "$REPO"

if [ ! -f .env ]; then
  echo "No .env in $REPO. Copy .env.example to .env and fill it in first."
  exit 1
fi

# A stable node path (fnm's per-shell paths disappear when the shell closes).
if command -v fnm > /dev/null; then
  NODE=$(fnm exec --using default node -e "process.stdout.write(process.execPath)")
else
  NODE=$(command -v node)
fi
if [ -z "$NODE" ]; then
  echo "node not found"
  exit 1
fi
echo "node: $NODE"

npm ci --silent
# Bundled Chromium is only the fallback; the installed Google Chrome is used when present.
npx playwright install chromium > /dev/null

# Checkout of the data branch, so the watchdog on GitHub can see this Mac's log.
# Pushes use the gh CLI's GitHub login (set on that checkout only), no token needed.
if [ ! -d data/.git ]; then
  git clone -q -b data https://github.com/rcoughlan/nie-cita.git data
fi
/bin/bash scripts/mac-data-auth.sh data
git -C data pull -q --rebase
git -C data push -q --dry-run && echo "data branch: push access OK"

GIT_DIR_PATH=$(dirname "$(command -v git)")
NODE_DIR=$(dirname "$NODE")

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-s</string>
    <string>$NODE</string>
    <string>--env-file=.env</string>
    <string>monitor.mjs</string>
    <string>--loop</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LOOP_MINUTES</key><string>forever</string>
    <key>DATA_DIR</key><string>data</string>
    <key>HEADED</key><string>1</string>
    <key>MINIMISED</key><string>1</string>
    <key>PATH</key><string>$NODE_DIR:$GIT_DIR_PATH:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOGFILE</string>
  <key>StandardErrorPath</key><string>$LOGFILE</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2> /dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed and started $LABEL. Log: $LOGFILE"
echo "Keep NordVPN connected to a Spain server; without it the monitor logs no-vpn and doesn't check."
