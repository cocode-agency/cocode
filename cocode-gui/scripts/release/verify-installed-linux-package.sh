#!/usr/bin/env bash

set -euo pipefail

format="${1:-}"
package_file="${2:-}"
if [[ "$format" != "deb" && "$format" != "rpm" ]] || [[ -z "$package_file" ]]; then
	printf 'Usage: %s <deb|rpm> <package-file>\n' "$0" >&2
	exit 2
fi
if [[ ! -f "$package_file" ]]; then
	printf 'Linux package is missing: %s\n' "$package_file" >&2
	exit 1
fi
package_file="$(realpath -- "$package_file")"

as_root() {
	if [[ "$(id -u)" -eq 0 ]]; then
		"$@"
	else
		sudo "$@"
	fi
}

package_name=""
installed=0
smoke_root=""
package_install_log=""

cleanup() {
	local status=$?
	local remove_status=0
	set +e
	if [[ "$installed" -eq 1 && -n "$package_name" ]]; then
		if [[ "$format" == "deb" ]]; then
			as_root env DEBIAN_FRONTEND=noninteractive apt-get remove -y "$package_name" || remove_status=$?
		else
			as_root dnf remove -y "$package_name" || remove_status=$?
		fi
	fi
	if [[ "$status" -eq 137 && -n "$smoke_root" ]]; then
		{
			printf '%s\n' '=== dmesg ==='
			dmesg -T 2>/dev/null | grep -Ei 'oom|out of memory|killed process' || true
			printf '%s\n' '=== journalctl ==='
			journalctl -k --since '-10 minutes' 2>/dev/null | grep -Ei 'oom|out of memory|killed process' || true
		} >"$smoke_root/kernel-kill-diagnostics.log" 2>&1
	fi
	if [[ -n "$smoke_root" ]]; then
		if [[ "${SMOKE_PRESERVE_ARTIFACTS:-0}" == "1" ]]; then
			printf 'Preserved smoke artifacts: %s\n' "$smoke_root" >&2
		else
			rm -rf "$smoke_root"
		fi
	fi
	if [[ "$status" -eq 0 && "$remove_status" -ne 0 ]]; then
		status="$remove_status"
	fi
	exit "$status"
}
trap cleanup EXIT

smoke_artifact_root="${SMOKE_ARTIFACT_ROOT:-${TMPDIR:-/tmp}}"
mkdir -p "$smoke_artifact_root"
smoke_root="$(mktemp -d "$smoke_artifact_root/cocode-linux-installed-smoke.XXXXXX")"
package_install_log="$smoke_root/rpm-install.log"

case "$format" in
	deb)
		command -v dpkg-deb >/dev/null
		command -v dpkg >/dev/null
		package_name="$(dpkg-deb -f "$package_file" Package)"
		if ! as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y "$package_file" >"$package_install_log" 2>&1; then
			printf 'DEB package installation failed: %s\n' "$package_file" >&2
			tail -n 200 "$package_install_log" >&2 || true
			exit 1
		fi
		app_path="$(dpkg -L "$package_name" | awk '$0 ~ /\/cocode-gui$/ { print; exit }')"
		;;
	rpm)
		command -v rpm >/dev/null
		command -v dnf >/dev/null
		package_name="$(rpm -qp --qf '%{NAME}' "$package_file")"
		if ! as_root dnf install -y "$package_file" >"$package_install_log" 2>&1; then
			printf 'RPM package installation failed: %s\n' "$package_file" >&2
			tail -n 200 "$package_install_log" >&2 || true
			exit 1
		fi
		app_path="$(rpm -ql "$package_name" | awk '$0 ~ /\/cocode-gui$/ { print; exit }')"
		;;
esac
installed=1

if [[ -z "${app_path:-}" || ! -x "$app_path" ]]; then
	printf 'Installed Linux GUI executable is missing: %s\n' "${app_path:-<unknown>}" >&2
	exit 1
fi

sandbox_path="$(dirname "$app_path")/chrome-sandbox"
if [[ ! -f "$sandbox_path" ]]; then
	printf 'Installed Linux sandbox helper is missing: %s\n' "$sandbox_path" >&2
	exit 1
fi
owner="$(stat -c '%u:%g' "$sandbox_path")"
mode="$(stat -c '%a' "$sandbox_path")"
if [[ "$owner" != "0:0" || "$mode" != "4755" ]]; then
	printf 'Installed chrome-sandbox must be root-owned with mode 4755: owner=%s mode=%s path=%s\n' \
		"$owner" "$mode" "$sandbox_path" >&2
	exit 1
fi

if command -v ldd >/dev/null 2>&1; then
	ldd_log="$smoke_root/ldd.log"
	ldd "$app_path" >"$ldd_log" 2>&1 || true
	missing_libraries="$(awk '/not found/ { print }' "$ldd_log")"
	if [[ -n "$missing_libraries" ]]; then
		printf 'Installed Linux GUI has unresolved shared libraries:\n%s\n' "$missing_libraries" >&2
		exit 1
	fi
fi

smoke_user="${SMOKE_USER:-$(id -un)}"
if ! id "$smoke_user" >/dev/null 2>&1; then
	if [[ "$(id -u)" -ne 0 ]]; then
		printf 'Smoke user does not exist and the verifier is not root: %s\n' "$smoke_user" >&2
		exit 1
	fi
	useradd --create-home --shell /bin/bash "$smoke_user"
fi
if [[ "$(id -u)" -ne 0 && "$smoke_user" != "$(id -un)" ]]; then
	printf 'A non-root verifier can only smoke-test as its current user: %s\n' "$smoke_user" >&2
	exit 1
fi

smoke_home="$(getent passwd "$smoke_user" | cut -d: -f6)"
smoke_group="$(id -gn "$smoke_user")"
log_root="$smoke_root/logs"
user_data_root="$smoke_root/user-data"
output_file="$smoke_root/output.log"
mkdir -p "$log_root" "$user_data_root"
chown -R "$smoke_user:$smoke_group" "$smoke_root"

command -v timeout >/dev/null
command -v xvfb-run >/dev/null
command -v runuser >/dev/null || [[ "$(id -u)" -ne 0 ]]

smoke_command=(
	env
	-u
	DBUS_SESSION_BUS_ADDRESS
	"HOME=$smoke_home"
	COCODE_AUTO_INSTALL_CLI=0
	ELECTRON_AUTO_UPDATE=off
	"COCODE_LOG_ROOT=$log_root"
	xvfb-run
	-a
	--server-args=-screen\ 0\ 1280x800x24
	timeout
	--signal=TERM
	--kill-after=5s
	30s
	"$app_path"
	--disable-gpu
	--disable-dev-shm-usage
	--user-data-dir
	"$user_data_root"
)

set +e
if [[ "$(id -u)" -eq 0 ]]; then
	runuser -u "$smoke_user" -- "${smoke_command[@]}" >"$output_file" 2>&1
	status=$?
else
	"${smoke_command[@]}" >"$output_file" 2>&1
	status=$?
fi
set -e

if [[ "$status" -ne 0 && "$status" -ne 124 ]]; then
	printf 'Installed Linux application exited with status %s.\n' "$status" >&2
	tail -n 120 "$output_file" >&2 || true
	exit "$status"
fi
if ! grep -R -qF "app.ready.completed" "$log_root"; then
	printf 'Installed Linux application did not report app.ready.completed.\n' >&2
	tail -n 120 "$output_file" >&2 || true
	exit 1
fi
