# Cocode TUI

Cocode TUI is the keyboard-first terminal client for Cocode sessions. It
connects to the shared Cocode DSH Host through the Host Supervisor and keeps
the terminal client separate from the Agent runtime.

> **Project status:** Developer preview. The source workspace is authoritative.
> Use a published `@cocode-agency/tui` only with the matching
> `@cocode-agency/host-supervisor` release.

## Requirements

- Node.js `22.19.x` or `24` and later
- pnpm `10.34.5` for source-checkout development (same pin as GUI / Host Supervisor)
- A real TTY for the interactive client
- A reachable Cocode DSH Host, normally started or discovered by the shared
  Host Supervisor

The interactive client does not run through a pipe or redirect. Use
`cocode --doctor` for non-interactive diagnostics.

## Quick start from the repository

```sh
cd cocode-tui
pnpm install
pnpm run build
node ./bin/cocode-tui.mjs --doctor
node ./bin/cocode-tui.mjs
```

From the repository root, the equivalent development flow is:

```sh
make install-tui
make dev tui
```

`make dev tui` runs the preflight checks first. It does not replace acceptance
in a real terminal; it only prepares the local dependencies and Host runtime.

## CLI reference

The installed executable is named `cocode`:

```text
cocode [options] [command]
```

| Command | Purpose |
| --- | --- |
| `cocode` or `cocode tui` | Start the terminal client |
| `cocode doctor` | Check the TUI build and shared Host prerequisites |
| `cocode host status` | Show the shared Host status |
| `cocode host status --json` | Print Host status for scripts |
| `cocode host stop` | Stop the shared Host when no client is using it |
| `cocode host stop --force` | Stop it even when leases are still held |
| `cocode gui` | Open the installed Cocode desktop client |
| `cocode plugin [args...]` | Manage bundled DSH plugins; defaults to the `cocode` profile |
| `cocode version` | Show Cocode and bundled DSH versions |
| `cocode --version` | Print the installed Cocode version |
| `cocode --help` | Print the complete CLI help |

Scope options can be used before a command:

```sh
cocode --dsh-home ~/.dsh --profile cocode
cocode --runtime-channel preview doctor
cocode plugin --profile cocode add dshmarket
cocode --profile cocode --dump-config
```

DSH-compatible commands and options are passed to the bundled DSH CLI unchanged,
so a separate `dsh` installation is not required. Cocode owns `--help` and
`--version`. When `cocode plugin` does not specify `--profile`, it uses the
`cocode` profile by default. The standalone `cocode web` command is disabled;
use `cocode gui` or `cocode tui` for the Cocode clients.

The shared DSH home can also be supplied through `COCODE_DSH_HOME`; the
launcher derives `DSH_HOME=COCODE_DSH_HOME` and uses the `cocode` profile for
the Cocode Host. `COCODE_RUNTIME_CHANNEL` selects the embedded runtime channel.

## Configuration

The CLI keeps Cocode account/runtime data separate from the shared DSH Home.
Settings, credentials, profile plugins, and session data remain in the DSH Home.

| Variable | Purpose | Default |
| --- | --- | --- |
| `COCODE_HOME` | Cocode account and runtime data | `~/.cocode` |
| `COCODE_DSH_HOME` | Shared DSH settings, credentials, profile plugins, and sessions | `~/.dsh` |
| `DSH_HOME` | Child Host alias derived from `COCODE_DSH_HOME` | `~/.dsh` |
| `DSH_PROFILE` | Child Host profile | `cocode` |
| `COCODE_HOST_CONFIG_FINGERPRINT` | Select a custom Host composition | Unset |
| `COCODE_RUNTIME_CHANNEL` | Select `stable`, `preview`, or `dev` runtime | `stable` |
| `DSH_SESSION_ROOT` | Session JSONL directory | `$DSH_HOME/sessions` |
| `COCODE_CWD` / `DSH_CWD` | Agent workspace override | Current directory |
| `COCODE_PROVIDER` | Provider override | Saved auth selection |
| `COCODE_MODEL` | Model override | Saved setting or runtime default |
| `COCODE_TUI_SCREEN` | `inline` or `alternate` screen mode | `inline` |
| `COCODE_TUI_THEME` | `dark`, `light`, or `system` | `system` |
| `COCODE_LANG` | `zh` or `en` UI language | Environment/default locale |

For local development, copy `.env.example` to `.env`. Do not put API keys in
`.env`; the TUI writes BYOK credentials to `$DSH_HOME/.credentials.yaml` and
keeps Cocode account tokens under `COCODE_HOME`.

## Authentication

On first launch, choose one of the following in the authentication screen:

- Paste a DeepSeek API key (BYOK).
- Sign in with a Cocode account when the hosted service is available.

The two modes can coexist on the same machine. In the running TUI, use
`/use byok`, `/use cocode`, `/login`, `/logout`, and `/status` as described in
the [authentication guide](./docs/zh/login.md).

## Documentation

- [中文文档](./docs/zh/README.md)
- [English documentation](./docs/en/README.md)
- [使用指南](./docs/zh/usage.md) · [Usage guide](./docs/en/usage.md)
- [权限与审批](./docs/zh/permissions.md) ·
  [Permissions and approvals](./docs/en/permissions.md)
- [平台与终端兼容性](./docs/zh/platforms.md) ·
  [Platform compatibility](./docs/en/platforms.md)
- [错误码](./docs/zh/errors.md) · [Error codes](./docs/en/errors.md)
- [开发 RFC](./.dev/rfc/README.md)

The usage guide is the source of truth for keyboard shortcuts, slash commands,
session workflows, image input, capability gating, and terminal-specific
behavior. This README only documents installation and launch boundaries.

## Development commands

Run these commands from `cocode-tui/`:

```sh
pnpm run dev          # Start from TypeScript source; requires a TTY
pnpm run build        # Build dist/cocode-tui.mjs
pnpm test             # Run the TUI test suite
pnpm run typecheck    # Check the TUI workspace types
pnpm run release:check
```

`pnpm run release:check` verifies the package metadata, required build output,
and packability. It does not publish the package and does not prove a real
terminal or live Host session.

## Publishing

The source workspace links `@cocode-agency/host-supervisor` from the sibling
`cocode-host-supervisor/` directory. A release package must resolve a matching
versioned Supervisor package instead of that local link.

To inspect a local package without publishing it:

```sh
pnpm run release:check
npm pack
```

Only install the generated tarball when the matching Host Supervisor package is
available. After both packages are released, the intended installation is:

```sh
npm install --global @cocode-agency/tui
cocode --doctor
```

## Troubleshooting

- `Cocode TUI requires a TTY.` — run `cocode` in a terminal, not through a
  pipe, redirect, or non-interactive CI step.
- `Cocode TUI is missing its build output.` — run `pnpm run build` in
  `cocode-tui/`.
- `cocode --doctor` reports a missing Host or JSON-RPC service — check
  `DSH_HOME`, `DSH_PROFILE`, and the matching Host Supervisor build before
  starting the TUI.
- Several TUI windows share one DSH home — close other windows before changing
  the machine-wide auth mode with `/use`, `/login`, or `/logout`.

For an error shown as `CODE · explanation`, see the [error catalog](./docs/zh/errors.md)
or its [English version](./docs/en/errors.md).
