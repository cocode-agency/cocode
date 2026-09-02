# Cocode plugins

This directory is the home for Cocode Desktop-specific DSH plugins.

- One plugin per direct child directory.
- Packages are private workspace packages.
- Electron stages them into its embedded DSH runtime.
- Electron mounts them through its generated `--patch` overlay.
- The integration never runs `dsh plugin add` or writes plugin entries into the
  user's local DSH profile.

`cocode-workbench` is Cocode's first-party Workbench implementation. It owns
the right and bottom docks, panel registry, host API, and persistence format.

## DSH upgrade contract

The Supervisor package defines the target DSH release train. Keep that exact
version aligned with the GUI DSH client dependencies and every plugin's DSH
peer dependency. From this workspace:

```sh
corepack pnpm@10.34.5 run check:dsh-contract
corepack pnpm@10.34.5 run check:dsh-compatibility
```

The first command is a fast manifest and injection-graph check. The second is
the release-grade check: it rebuilds Cocode plugins and Electron, runs the GUI
and Supervisor tests, stages the npm runtime from scratch, and verifies the
runtime manifest, dependency closure, native inventory, and content hashes.
