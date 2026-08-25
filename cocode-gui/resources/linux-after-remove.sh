#!/bin/bash

set -e

APP_ROOT='/opt/${sanitizedProductName}'
GUI_COMMAND='${executable}'
TUI_COMMAND='/usr/bin/cocode'
TUI_MARKER='# cocode-linux-tui-wrapper:v1'

if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove "$GUI_COMMAND" "$APP_ROOT/$GUI_COMMAND" || true
    update-alternatives --remove 'cocode' "$APP_ROOT/cocode" || true
else
    rm -f "/usr/bin/$GUI_COMMAND"
fi

if [ -f "$TUI_COMMAND" ] && grep -qF "$TUI_MARKER" "$TUI_COMMAND"; then
    rm -f "$TUI_COMMAND"
fi

PROFILE='/etc/profile.d/cocode.sh'
MARKER='# cocode-desktop-environment:v1'
case "${1:-}" in
    upgrade|failed-upgrade|1) ;;
    *)
        if [ -f "$PROFILE" ] && grep -qF "$MARKER" "$PROFILE"; then
            rm -f "$PROFILE"
        fi
        ;;
esac

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
