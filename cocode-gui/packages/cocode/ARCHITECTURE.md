# Cocode DSH plugins

`packages/cocode/*` contains project-owned DSH plugins that ship only with
Cocode Desktop. Each direct child is an independent Host/client plugin package.

Published DSH client packages are upstream dependencies loaded from npm.
Product behavior belongs in these Cocode packages. Prefer a slot / service /
overlay hook; ask upstream for a seam when none exists; use a version-pinned
`patches/*.patch` only for holes with no extension point (Loader internals,
compiled `lib/` output).

The Electron packaging pipeline builds these packages, copies their runtime
closure into the staged DSH sidecar, and mounts them through the Electron-owned
`--patch` overlay. Do not install them with `dsh plugin add`, and do not edit a
user's local DSH profile, package manifest, lockfile, or `cordis.patch.yml`.

The Supervisor and Electron overlay helpers are composition infrastructure only:
they disable conflicting upstream registrations, insert these package names, and
wire transport/bootstrap paths. They must not contain a second copy of Cocode
product UI or business logic.

Workbench dock slots (`workbench.right`, `workbench.bottom`) remain declared by
the npm DSH layout plugin so `cocode-workbench` can occupy them. Replacing the
whole layout package would be a larger overlay; do not grow other in-tree forks
around that seam.

Plugin Host code runs inside the trusted DSH sidecar. Browser code must keep the
official DSH client-plugin ABI and use the desktop transport adapter for
sidecar-owned HTTP/WebSocket routes. Runtime dependencies must be declared in
the package manifest's `cocode.runtimeDependencies` allow-list so staging stays
auditable and does not copy the entire development dependency graph.
