#!/usr/bin/env bash
set -euo pipefail

if ! command -v harbor >/dev/null 2>&1; then
  echo "harbor is required. Install it with: uv tool install harbor" >&2
  exit 127
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dataset="${HARBOR_DATASET:-terminal-bench@2.0}"
model="${HARBOR_MODEL:-deepseek/deepseek-v4-flash}"
concurrency="${HARBOR_CONCURRENCY:-1}"
reasoning_effort="${HARBOR_REASONING_EFFORT:-}"
timeout_sec="${HARBOR_AGENT_TIMEOUT_SEC:-1800}"
cocode_package="${HARBOR_COCODE_PACKAGE:-@cocode-agency/tui@latest}"
artifact_dir=""

cleanup() {
  if [[ -n "${artifact_dir}" && -d "${artifact_dir}" ]]; then
    rm -rf -- "${artifact_dir}"
  fi
}
trap cleanup EXIT

export PYTHONPATH="${script_dir}${PYTHONPATH:+:${PYTHONPATH}}"

args=(
  run
  -d "${dataset}"
  --agent cocode_agent:CocodeAgent
  -m "${model}"
  -n "${concurrency}"
  --agent-kwarg "timeout_sec=${timeout_sec}"
  --agent-kwarg "package=${cocode_package}"
)

if [[ -n "${reasoning_effort}" ]]; then
  args+=(--agent-kwarg "reasoning_effort=${reasoning_effort}")
fi

if [[ "${HARBOR_COCODE_LOCAL:-0}" == "1" ]]; then
  artifact_dir="$(mktemp -d /tmp/cocode-benchmark-packages.XXXXXX)"
  "${script_dir}/pack-local.sh" "${artifact_dir}" >/dev/null
  tui_tarball="$(find "${artifact_dir}" -maxdepth 1 -type f -name '*-tui-*.tgz' -print -quit)"
  supervisor_tarball="$(find "${artifact_dir}" -maxdepth 1 -type f -name '*-host-supervisor-*.tgz' -print -quit)"
  if [[ -z "${tui_tarball}" || -z "${supervisor_tarball}" ]]; then
    echo "failed to build local Cocode benchmark packages" >&2
    exit 1
  fi
  args+=(
    --agent-kwarg "tui_tarball_path=${tui_tarball}"
    --agent-kwarg "supervisor_tarball_path=${supervisor_tarball}"
  )
fi

harbor "${args[@]}" "$@"
