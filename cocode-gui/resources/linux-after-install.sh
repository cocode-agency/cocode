#!/bin/bash

set -e

# Keep the standard electron-builder integration points: the desktop launcher
# is available immediately after a package install, and desktop/mime caches are
# refreshed when those tools are present.
APP_ROOT='/opt/${sanitizedProductName}'
GUI_COMMAND='${executable}'
TUI_COMMAND='/usr/bin/cocode'
TUI_MARKER='# cocode-linux-tui-wrapper:v1'
PROFILE='/etc/profile.d/cocode.sh'
PROFILE_MARKER='# cocode-desktop-environment:v1'

if type update-alternatives >/dev/null 2>&1; then
    if [ -L "/usr/bin/$GUI_COMMAND" ] && [ -e "/usr/bin/$GUI_COMMAND" ] && [ "$(readlink "/usr/bin/$GUI_COMMAND")" != "/etc/alternatives/$GUI_COMMAND" ]; then
        rm -f "/usr/bin/$GUI_COMMAND"
    fi
    update-alternatives --install "/usr/bin/$GUI_COMMAND" "$GUI_COMMAND" "$APP_ROOT/$GUI_COMMAND" 100 || ln -sfn "$APP_ROOT/$GUI_COMMAND" "/usr/bin/$GUI_COMMAND"
else
    ln -sfn "$APP_ROOT/$GUI_COMMAND" "/usr/bin/$GUI_COMMAND"
fi

# Older Linux packages registered the Desktop executable as /usr/bin/cocode.
# Remove only that known Cocode-owned registration before installing the new
# TUI command. Never overwrite an unrelated executable at the public command.
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove 'cocode' "$APP_ROOT/cocode" || true
fi
if [ -L "$TUI_COMMAND" ]; then
    legacy_target="$(readlink "$TUI_COMMAND")"
    if [ "$legacy_target" = '/etc/alternatives/cocode' ] || [ "$legacy_target" = "$APP_ROOT/cocode" ]; then
        rm -f "$TUI_COMMAND"
    fi
fi
if [ -e "$TUI_COMMAND" ] && ! grep -qF "$TUI_MARKER" "$TUI_COMMAND" 2>/dev/null; then
    echo "Cocode: refusing to replace unmanaged $TUI_COMMAND" >&2
    exit 1
fi

# The package maintainer script runs as root, but this wrapper runs later as the
# actual terminal user. Resolve HOME at invocation time so each user gets an
# isolated Cocode and DSH state directory.
temporary="$(mktemp "$TUI_COMMAND.tmp.XXXXXX")"
trap 'rm -f "$temporary"' EXIT
cat > "$temporary" <<EOF
#!/bin/sh
$TUI_MARKER
set -eu

if [ -z "\${HOME:-}" ]; then
    echo "cocode: HOME is not set; cannot resolve the user data directory." >&2
    exit 1
fi

APP_ROOT="$APP_ROOT"
NODE="\$APP_ROOT/resources/cocode-node"
TUI_ENTRY="\$APP_ROOT/resources/tui/cocode-cli.mjs"
SUPERVISOR_ENTRY="\$APP_ROOT/resources/dsh-runtime/packages/host-supervisor/lib/bin.js"

export COCODE_HOME="\${COCODE_HOME:-\$HOME/.cocode}"
export COCODE_DSH_HOME="\${COCODE_DSH_HOME:-\$HOME/.dsh}"
export DSH_HOME="\$COCODE_DSH_HOME"
export DSH_PROFILE="cocode"
export COCODE_TUI_CLIENT_KIND="standalone-tui"
export COCODE_NODE_EXECUTABLE="\${COCODE_NODE_EXECUTABLE:-\$NODE}"
export COCODE_SUPERVISOR_SERVICE_ENTRY="\${COCODE_SUPERVISOR_SERVICE_ENTRY:-\$SUPERVISOR_ENTRY}"
export COCODE_HOST_CONFIG_FINGERPRINT="\${COCODE_HOST_CONFIG_FINGERPRINT:-cocode-web-jsonrpc-v3}"
export COCODE_RUNTIME_CHANNEL="\${COCODE_RUNTIME_CHANNEL:-stable}"

if [ ! -x "\$COCODE_NODE_EXECUTABLE" ]; then
    echo "cocode: packaged Node executable is missing: \$COCODE_NODE_EXECUTABLE" >&2
    exit 1
fi
if [ ! -f "\$TUI_ENTRY" ]; then
    echo "cocode: packaged TUI entry is missing: \$TUI_ENTRY" >&2
    exit 1
fi

exec "\$COCODE_NODE_EXECUTABLE" "\$TUI_ENTRY" "\$@"
EOF
chmod 0755 "$temporary"
mv -f "$temporary" "$TUI_COMMAND"
trap - EXIT

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# Remove the v1 profile fragment created by older packages. The command above
# is now self-contained and must not depend on login-shell profile loading.
if [ -f "$PROFILE" ] && grep -qF "$PROFILE_MARKER" "$PROFILE"; then
    rm -f "$PROFILE"
elif [ -e "$PROFILE" ]; then
    echo "Cocode: preserving unmanaged $PROFILE" >&2
fi

# Chromium's Linux sandbox helper must be owned by root and retain the SUID bit.
# Package extraction can otherwise leave it as an ordinary user-owned 0755 file,
# which makes Electron abort during sandbox initialization before app code runs.
SANDBOX='/opt/${sanitizedProductName}/chrome-sandbox'
if [ ! -f "$SANDBOX" ]; then
    echo "Cocode: Chromium sandbox helper is missing: $SANDBOX" >&2
    exit 1
fi
chown root:root "$SANDBOX"
chmod 4755 "$SANDBOX"
