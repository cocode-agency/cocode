# DSH runtime context

The DSH runtime is a managed sidecar shipped inside the Electron application. Electron starts it with the embedded Electron Node runtime, so an installed desktop user does not need a separate Node.js, pnpm, or `dsh` executable.

Development and production resolve the independent `@cocode-agency/host-supervisor` runtime. The Supervisor owns an immutable `@deepseek-ai/dsh` npm closure, starts one shared Host per canonical `DSH_HOME + profile + configuration`, and exposes the Host Web endpoint to Electron. Electron never discovers or starts a Harness checkout.

The sidecar owns the existing DSH Web HTTP and WebSocket protocol. Electron loads
the local Vite Renderer build, while Main reads the sidecar's
`window.__DSH_BOOT__` manifest and returns it through the narrow `desktopApi.dsh`
bridge. Published DSH client bundles are loaded from npm packages and emitted
under the Renderer build's `dsh-client/` tree. Cocode-owned client bundles are
built from `packages/cocode/*` plugins and use the same loader layout; non-copied
host bundles continue to resolve against the sidecar origin.

The embedded Cocode sidecar is an independent product runtime with a shared DSH
home: `COCODE_HOME` (default `~/.cocode`) owns the account file, runtime slots,
and Supervisor state; `COCODE_DSH_HOME` (default `~/.dsh`) is passed as `DSH_HOME`
with the fixed profile `cocode`. Settings, credentials, profile plugins,
sessions, workspace storage, projection cache, attachments, home-level
`cordis.patch.yml`, and `profiles/node_modules` remain in the shared DSH home.
The official launcher continues to use the same DSH home with profile `web`.
The two Hosts are independent, but they intentionally share the DSH Home
configuration and business data.

Main may also create a Shared DSH data reader (the compatibility implementation
is still named `ExternalDshReadSource`) for the shared home. It is an allow-listed,
filesystem-read-only observation path for `sessions/**`, `storages/workspace.json`,
the optional projection cache and opt-in attachments. Mutations go through the
Cocode Host API. Because that Host uses the same `DSH_HOME`, the normal
`ctx.sessions` and `ctx.workspaces` services are the single Desktop catalog and
sidebar interaction surface. There is no separate "Shared DSH history" client
entry. The reader remains a Main-owned observation and conflict-diagnostics
capability; it is not mounted as another client Store.

GUI and TUI read and write the shared DSH settings and credentials directly:
`~/.dsh/settings.yaml` and `~/.dsh/.credentials.yaml`. There is no credentials
copy, migration marker, or `.cocode/credentials` fallback. Cocode account
identity remains in `~/.cocode/account.yaml`.

The shared objects are writable from Cocode, but the product does not support
concurrent writes by the official Host and Cocode Host to the same Session or
Workspace. Best-effort revision checks report
`SHARED_HOME_CONFLICT`; they do not provide a cross-process lock, CAS, merge, or
automatic retry.

The shared home also means that `cordis.patch.yml` and
`profiles/node_modules` remain common DSH surfaces. Cocode owns only its
`profiles/cocode` manifest and runtime slot; user/profile plugin state is under
the shared `~/.dsh/profiles/cocode` tree. It does not modify the official
`profiles/web` contents, but shared Home-level patch and dependency fallback
behavior remains a documented limitation.

HTTP `/api` traffic crosses the typed Preload/Main request bridge so a
`file://`/Vite Renderer never depends on CORS. The two WebSocket downlinks remain
native browser sockets; the Main shell rewrites only their trust markers for the
loopback sidecar before the connection plugin's existing Host/Origin fence runs.
The development-only `client-hmr` entry is retained for Vite development but is
removed from packaged boot so its `/plugins/events` SSE route is never resolved
relative to `file://`.

Electron development owns the missing source-build half of that HMR chain.
`scripts/start-with-dsh-runtime.mjs` starts `scripts/watch-dsh-client.mjs` before
the Electron Vite dev process. The watcher discovers packages declaring `dsh.client.platform: web`,
rebuilds only a missing, stale or changed package's browser bundle from its local
`src/client` entry, and atomically mirrors the emitted `lib/client.js` into the
staged sidecar runtime. The sidecar's existing `client-hmr` poller then observes
the mirrored bundle hash, emits a `/plugins/events` rebuilt frame and lets the
browser replace the affected Cordis plugin fiber without reloading the page.
Local Vite bundle responses are `no-store` so the replacement always executes
the newly emitted bytes.
Main stops the sidecar before Electron quits; a failed readiness or bootstrap
handshake leaves a diagnostic startup surface instead of exposing a partially
mounted UI.
