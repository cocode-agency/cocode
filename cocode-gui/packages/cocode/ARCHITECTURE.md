# Cocode DSH plugins

`packages/cocode/*` contains project-owned DSH plugins that ship only with
Cocode Desktop. Each direct child is an independent Host/client plugin package.

`packages/client` is an upstream DSH snapshot. Product behavior belongs here,
not in that tree. Prefer a slot / service / overlay hook; ask upstream for a
seam when none exists; use a version-pinned `patches/*.patch` only for holes
with no extension point (Loader internals, compiled `lib/` output). Remaining
in-tree forks in `packages/client` (connection `file://` loopback, theme tokens
and Appearance font-size section, message-feedback account remote, models
account-gate, Settings nav icons, sidebar titlebar drag, hidden composer stats)
are patch candidates on the next DSH upgrade — do not grow them.

The Electron packaging pipeline builds these packages, copies their runtime
closure into the staged DSH sidecar, and mounts them through the Electron-owned
`--patch` overlay. Do not install them with `dsh plugin add`, and do not edit a
user's local DSH profile, package manifest, lockfile, or `cordis.patch.yml`.

Plugin Host code runs inside the trusted DSH sidecar. Browser code must keep the
official DSH client-plugin ABI and use the desktop transport adapter for
sidecar-owned HTTP/WebSocket routes. Runtime dependencies must be declared in
the package manifest's `cocode.runtimeDependencies` allow-list so staging stays
auditable and does not copy the entire development dependency graph.
