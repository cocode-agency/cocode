# Cocode DSH plugins

`packages/cocode/*` contains project-owned DSH plugins that ship only with
Cocode Desktop. Each direct child is an independent Host/client plugin package.

`packages/client` is an upstream DSH snapshot. Product behavior belongs here,
not in that tree. Prefer a slot / service / overlay hook; ask upstream for a
seam when none exists; use a version-pinned `patches/*.patch` only for holes
with no extension point (Loader internals, compiled `lib/` output).

The Electron packaging pipeline builds these packages, copies their runtime
closure into the staged DSH sidecar, and mounts them through the Electron-owned
`--patch` overlay. Do not install them with `dsh plugin add`, and do not edit a
user's local DSH profile, package manifest, lockfile, or `cordis.patch.yml`.

Workbench dock slots (`workbench.right`, `workbench.bottom`) remain declared by
the vendored layout plugin so `cocode-workbench` can occupy them. Replacing the
whole layout package would be a larger overlay; do not grow other in-tree forks
around that seam.

Plugin Host code runs inside the trusted DSH sidecar. Browser code must keep the
official DSH client-plugin ABI and use the desktop transport adapter for
sidecar-owned HTTP/WebSocket routes. Runtime dependencies must be declared in
the package manifest's `cocode.runtimeDependencies` allow-list so staging stays
auditable and does not copy the entire development dependency graph.
