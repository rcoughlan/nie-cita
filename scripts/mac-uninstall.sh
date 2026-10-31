#!/bin/bash
# Stop and remove the monitor's LaunchAgent. Leaves the repo, .env and data/ alone.
#   /bin/bash scripts/mac-uninstall.sh
LABEL=dev.ryancoughlan.nie-cita
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2> /dev/null && echo "Stopped $LABEL" || echo "$LABEL was not running"
rm -f "$PLIST" && echo "Removed $PLIST"
