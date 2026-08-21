# Cocode GUI

Cocode GUI is the Electron desktop client for the shared Cocode DSH Host. It
provides the workspace surface for sessions, files, terminals, diffs, and
attachments while the Host owns agent execution and session persistence.

> **Project status:** Developer preview. This package is a private Electron
> workspace and is built from source as part of the Cocode repository. Release
> scripts produce signed macOS/Windows artifacts and native Linux AppImages.

See the [repository README](../README.md) for the overall architecture,
component boundaries, credentials, and TUI setup.

## Requirements

- Node.js `22.12.0` or newer
- pnpm `10.34.5` exactly
- Python 3 for native module builds
- macOS 12 or newer, Windows 10 or newer, or 64-bit Linux
- `x64` or `arm64`

Use Node Version Manager when available:

```sh
nvm use
```

Enable the pinned pnpm version through Corepack:

```sh
corepack pnpm@10.34.5 --version
```

Check the complete environment before installing or building:

```sh
corepack pnpm@10.34.5 check:env
```

## Development

Install dependencies from this directory:

```sh
corepack pnpm@10.34.5 install
```

Useful commands:

```sh
corepack pnpm@10.34.5 dev          # Electron desktop client + Vite
corepack pnpm@10.34.5 dev:web      # Browser-only GUI on :5273
corepack pnpm@10.34.5 typecheck
corepack pnpm@10.34.5 lint
corepack pnpm@10.34.5 test
corepack pnpm@10.34.5 package      # Package for the current platform
corepack pnpm@10.34.5 make         # Build distributables for the current platform
```

During development, the GUI stages the Cocode runtime through the sibling
`cocode-host-supervisor` workspace. The repository-level shortcuts are also
available:

```sh
cd ..
make install-gui
make dev gui
make dev gui-web
```

The staged runtime is kept in the operating-system cache directory. Refresh or
disable that cache when diagnosing a stale local runtime:

```sh
DSH_FORCE_RESTAGE=1 make dev gui
DSH_DISABLE_RUNTIME_CACHE=1 make dev gui
```

## Host and credentials

The GUI connects to the shared Host through `@cocode-agency/host-supervisor`. To share
sessions with Cocode TUI, use the same `DSH_HOME`, `DSH_PROFILE`, and Host
configuration scope in both clients.

Cocode does not include a hosted backend or a model. You can provide a DeepSeek
API key through the DSH credentials flow, or use a hosted Cocode account where
that separate service is available. Credentials are kept outside the session
log; do not commit local credential files or `.env` files.

## Release behavior

Platform-specific release scripts are:

```sh
corepack pnpm@10.34.5 run release:mac:x64
corepack pnpm@10.34.5 run release:mac:arm64
corepack pnpm@10.34.5 run release:win:x64
corepack pnpm@10.34.5 run release:win:arm64
corepack pnpm@10.34.5 run release:linux:x64
corepack pnpm@10.34.5 run release:linux:arm64
```

The Linux commands must run on a native Linux host matching the requested
architecture. The release gate rejects macOS/Windows hosts, a mismatched
`uname -m`, and cross-compilation overrides such as `npm_config_arch`; there is
no x64-to-arm64 release path. Linux output is written under
`release/linux/<arch>/` as `Cocode-<version>-x86_64.AppImage` or
`Cocode-<version>-arm64.AppImage`. Local commands always use
`--publish never`.

For a clean Linux checkout, install the three sibling workspaces before the
release command (the CI workflow uses the same order):

```sh
cd ../cocode-host-supervisor && corepack pnpm@10.34.5 install --frozen-lockfile --ignore-scripts
cd ../cocode-tui && corepack pnpm@10.34.5 install --frozen-lockfile --ignore-scripts
cd ../cocode-gui && corepack pnpm@10.34.5 install --frozen-lockfile
```

Use `xvfb-run -a release/linux/<arch>/*.AppImage --disable-gpu --no-sandbox`
for a headless launch smoke when the host has no display. The release verifier
also checks the AppImage ELF machine, embedded runtime/TUI/native modules,
updater metadata, checksums, and architecture-scoped release manifest.

Signed macOS ZIP and Windows NSIS builds, plus Linux AppImage builds, use
`electron-updater` with the shared GitHub Releases repository. Linux x86_64
uses `latest-linux.yml`; Linux arm64 uses `latest-linux-arm64.yml`. The
architecture-specific checksum and evidence files are named
`SHA256SUMS-x64`/`SHA256SUMS-arm64` and
`linux-release-manifest-x64.json`/`linux-release-manifest-arm64.json` so they
can coexist in GitHub Release's flat asset namespace. A Draft Release is
published only by the protected GitHub Actions publish job after both native
architectures pass verification. Development builds and Linux `--dir` or
unpacked AppDirs do not start the updater; automatic updates require launching
the real executable AppImage with its executable bit preserved.

Windows x64 and ARM64 releases are per-user NSIS installers. Formal releases
must use the configured team signing service; the release and update path does
not include legacy package formats.

The production macOS release can include a signed PKG that installs
`Cocode.app` and the `cocode` command. Windows installers register the
Desktop-managed `cocode.cmd` shim. Signing, notarization, and release secrets
are required only for maintainers running the release workflow; they are not
needed for local development.

## Contributing

Run the focused checks before opening a pull request:

```sh
corepack pnpm@10.34.5 typecheck
corepack pnpm@10.34.5 lint
corepack pnpm@10.34.5 test
```

See the repository [CONTRIBUTING.md](../CONTRIBUTING.md) and
[SECURITY.md](../SECURITY.md) for contribution and vulnerability-reporting
processes. Build output and the generated runtime are local artifacts and must
not be committed.
