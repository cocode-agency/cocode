#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
output_dir="${1:-$(mktemp -d /tmp/cocode-benchmark-packages.XXXXXX)}"
mkdir -p "${output_dir}"
output_dir="$(cd "${output_dir}" && pwd)"

pnpm --dir "${repo_root}/cocode-host-supervisor" run build
(
  cd "${repo_root}/cocode-host-supervisor"
  npm pack --pack-destination "${output_dir}" >/dev/null
)

pnpm --dir "${repo_root}/cocode-tui" run build
(
  cd "${repo_root}/cocode-tui"
  npm pack --pack-destination "${output_dir}" >/dev/null
)

find "${output_dir}" -maxdepth 1 -type f -name '*.tgz' -print | sort
