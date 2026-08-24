# Cocode benchmarks

This directory contains the automated benchmark integration for Cocode. It
uses Harbor to provide task containers, dataset selection, official verifiers,
parallel execution, retries, and result storage. Cocode contributes an
installed-agent adapter that drives the public non-interactive `cocode run`
command inside each task container.

## Prerequisites

- Docker
- Python 3.12+
- Harbor installed with `uv tool install harbor`
- A model API key exported using the environment variable expected by Harbor

The default dataset follows Harbor's current Terminal-Bench documentation. To
run another published revision, override `HARBOR_DATASET`.

## Run Terminal-Bench

From the repository root:

```sh
HARBOR_MODEL=deepseek/deepseek-v4-flash \
HARBOR_REASONING_EFFORT=max \
HARBOR_CONCURRENCY=4 \
make benchmark-terminal
```

By default the container installs `@cocode-agency/tui@latest`. Pin the exact
artifact under test so the result is reproducible and cannot drift to a newer
release:

```sh
HARBOR_COCODE_PACKAGE='@cocode-agency/tui@0.1.1' make benchmark-terminal
```

The selected package must contain the `cocode run` command. A source checkout
on the host is not automatically visible inside Harbor task containers. To
test the current checkout, build matching TUI and Host Supervisor tarballs and
upload them into every task container automatically:

```sh
HARBOR_COCODE_LOCAL=1 \
HARBOR_MODEL=deepseek/deepseek-v4-flash \
make benchmark-terminal ARGS='--include-task-name hello-world'
```

The temporary tarballs are removed after Harbor exits. They are not written
into the repository or committed.

To request the revision shown in a particular comparison, set it explicitly:

```sh
HARBOR_DATASET=terminal-bench@2.1 make benchmark-terminal
```

Whether that dataset revision is available is determined by the installed
Harbor registry. The runner does not silently substitute another version.

Additional Harbor arguments are forwarded after `--`:

```sh
make benchmark-terminal ARGS='--include-task-name hello-world --max-retries 0'
```

Direct invocation is also supported:

```sh
benchmarks/harbor/run-terminal-bench.sh --include-task-name hello-world
```

Each task runs Cocode in its own container with isolated DSH, Supervisor,
runtime, session, and event-log directories. Tool approvals default to
`allow`, questions are cancelled because the run is non-interactive, and
Harbor executes the task's verifier after Cocode exits.

## Headless smoke test

The adapter depends on the public headless command, which can be tested without
Harbor:

```sh
cd cocode-tui
pnpm run build
node ./bin/cocode-tui.mjs run \
  --cwd /path/to/workspace \
  --provider deepseek-official \
  --model deepseek-v4-flash \
  --reasoning-effort max \
  --allow-tools \
  --timeout 30m \
  --event-log /tmp/cocode-events.jsonl \
  --json \
  --prompt 'Run the tests and fix the failing implementation.'
```

`cocode run` exits `0` only after the session reports `running` and then
`idle`. A timeout cancels the session and exits `124`. Other setup, provider,
or protocol failures exit `1`.
