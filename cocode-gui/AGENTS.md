# Cocode Agent Engineering Rules

This file is the repository-level development contract. Every agent working in this
repository MUST read and follow it before changing code. User instructions for a
specific task take precedence when they explicitly conflict with this file; otherwise
these rules are mandatory.

## 1. Agent instruction portability

When adding or revising agent constraints, prompts or examples in this file:

- MUST NOT include personal names, usernames, email addresses, machine names,
  user-home paths or other person/device-specific identifiers.
- MUST use repository-relative paths, environment variables, standard tool
  discovery or neutral placeholders so the instructions can be reused directly
  on another device.
- MUST NOT assume a particular operating system, shell, checkout location or
  locally installed absolute binary path. If a platform-specific step is
  unavoidable, state the condition and provide a discoverable alternative.
- MUST keep the resulting instructions independent of local environment state;
  do not encode secrets, local credentials, or assumptions about another
  developer's filesystem.

## 2. Project baseline

This repository is an electron-vite + electron-builder + TypeScript desktop application.

- Node.js: `>=22.12.0` (use the version in `.nvmrc` when available).
- pnpm: `10.34.5` exactly.
- Electron: `43.x` as pinned by `package.json`.
- Renderer: React `18.x`.
- Styling: Tailwind CSS `3.x` with PostCSS.
- UI primitives: shadcn/ui source components backed by Radix UI.
- Class composition: `clsx` + `tailwind-merge` through `cn()`.

Before running project commands, use the repository runtime. If `.nvmrc` exists,
select the version declared there; otherwise use a compatible Node.js version
from the `engines` field. Run pnpm through Corepack at the pinned version:

```bash
corepack pnpm@10.34.5 <command>
```

Do not weaken `engines` constraints or upgrade React to 19 / Tailwind to 4 as a
shortcut for a local environment mismatch.

## 3. Source tree and ownership

The source tree is organized by Electron runtime boundary first, then by business
boundary:

```text
src/
├── main/                  # trusted Electron main process
├── preload/               # minimal, allow-listed context bridge
├── renderer/              # React renderer process
├── contracts/             # cross-process protocol and DTO definitions
└── shared/                # pure TypeScript code safe for every runtime
```

### `src/main`

Main owns privileged desktop capabilities and the authoritative business model.

```text
src/main/
├── index.ts               # thin process entry; calls bootstrap only
├── bootstrap/             # composition root and dependency wiring
├── shell/                 # Electron lifecycle and desktop shell adapters
├── contexts/              # main-process bounded contexts
└── shared/                # main-only technical capabilities
```

`main/shell` may contain Electron APIs, BrowserWindow management, menus, tray,
protocols, updater, shortcuts, security and lifecycle code. It MUST NOT contain
business rules that belong in a bounded context.

`main/index.ts` MUST remain thin. Move lifecycle, window creation and registrations
to focused modules under `bootstrap` or `shell`.

### `src/preload`

Preload is the only bridge between privileged Main APIs and Renderer code.

```text
src/preload/
├── index.ts               # thin preload entry
├── bridges/               # allow-listed APIs grouped by capability/context
├── validators/            # runtime validation of IPC inputs/outputs
└── types/                 # Window/global declarations for exposed APIs
```

Preload MUST expose narrow capability APIs through `contextBridge`. Never expose
`ipcRenderer`, `ipcMain`, Node.js modules, or a generic `send/invoke` wrapper.
Preload MUST NOT implement domain rules or become a second application service layer.

### `src/renderer`

Renderer owns React presentation, user interaction and renderer-local application
state. It MUST NOT import Electron or Node.js privileged APIs.

```text
src/renderer/
├── index.tsx              # React 18 createRoot entry
├── app/                   # renderer composition root, providers, router, layouts
├── contexts/              # UI-side bounded contexts
├── components/ui/         # shadcn/ui source components
├── hooks/                 # renderer-wide hooks used by multiple contexts
├── lib/                   # renderer-wide technical helpers, including cn()
├── shared/                # renderer-only generic UI/state utilities
└── styles/                # Tailwind layers, tokens and global styles
```

`src/renderer/app/App.tsx` is the application shell. It may compose providers and
routes, but business workflows belong in a context.

### `src/contracts`

`contracts` defines how independent runtime boundaries communicate:

```text
src/contracts/
├── ipc/                   # channel names, request/response DTOs
├── events/                # cross-boundary event payloads
└── schemas/               # runtime schemas for boundary validation
```

Contracts describe what is sent, received and returned. They MUST NOT contain
repositories, database adapters, Electron calls, business implementations or UI
components.

### `src/shared`

Root shared code is pure, runtime-neutral TypeScript that is safe to import from
Main, Preload and Renderer. Examples include:

- DDD kernel abstractions (`Result`, entity/value-object base types, domain event base
  types) when genuinely shared.
- Cross-runtime primitive types and constants.
- Pure serialization or collection utilities with no Electron, React, DOM, filesystem,
  network or process-global dependency.

Do not put business services, repositories, UI components, IPC channels or runtime
adapters in root `shared`.

The other two `shared` directories are intentionally scoped:

- `src/main/shared`: Main-only logging, configuration, persistence and observability.
- `src/renderer/shared`: Renderer-only UI primitives, hooks, state and assets.

Do not move code to root `src/shared` merely because two files look similar. Promote
code only when it is stable, generic, runtime-neutral and used across boundaries.

### `src/main/contexts/database`

The database context is the only current owner of `better-sqlite3`:

- `better-sqlite3` imports MUST stay under `src/main/contexts/database/infrastructure`.
- The current example uses one `records` table per database with JSON-serializable
  values; do not expose arbitrary SQL through IPC.
- Global data lives at `<user-home>/.magic/global.db`.
- Session data lives at `<user-home>/.magic/sessions/<sessionId>/user.db`.
- Use Electron `app.getPath('home')` to determine the user-home directory; do not use a
  hard-coded path or an environment variable from Renderer.
- Session IDs MUST be validated before constructing a path. Never concatenate an
  unvalidated user-provided session ID into a filesystem path.
- The Global database is initialized during Main `ready`; Session databases are lazy.
- Native database connections are owned and closed by the database module, not by IPC
  handlers or Renderer code.
- New business tables belong to their owning bounded context, not automatically in the
  example database table.

## 4. Bounded contexts and DDD rules

`contexts/_template` is a template only. Do not implement business features inside
`_template`. When a real business capability appears, copy the template and rename it
using the product's ubiquitous language:

```text
src/main/contexts/workspace/
src/main/contexts/document/
src/renderer/contexts/workspace/
src/renderer/contexts/editor/
```

Context names represent business capabilities, not pages, routes or generic UI
containers. Prefer `document`, `workspace`, `account`, `settings`, `editor` over
`home`, `detail`, `list`, `page-a`.

Main and Renderer contexts do not need one-to-one names. Main contexts model trusted
business capabilities; Renderer contexts model user-facing interaction capabilities.

### Context layers

Use layers only when the feature's complexity justifies them. Do not create empty
layers for a trivial screen.

```text
<context>/
├── domain/
├── application/
├── infrastructure/
└── presentation/
```

#### Domain

Contains business concepts and rules that are independent of transport and storage:

- Main: entities, aggregate roots, value objects, domain services, domain events,
  repository interfaces and domain errors.
- Renderer: interaction models, UI-side value objects and local interaction rules.

Domain code MUST be framework- and runtime-neutral. It MUST NOT import Electron,
React components, `ipcRenderer`, `fs`, database clients, network clients or concrete
repositories.

Renderer domain models are not copies of Main domain entities. Main is authoritative
for persisted/secure business truth; Renderer models presentation and interaction
state.

#### Application

Orchestrates use cases. It may depend on domain types and declared ports, but not on
concrete infrastructure implementations.

Typical folders:

```text
application/
├── commands/
├── queries/
├── use-cases/
├── dto/
└── ports/
```

Commands change state; queries read state; use cases coordinate either flow. Keep
application services explicit and focused. Do not put React rendering, Electron calls,
database calls or filesystem calls here.

#### Infrastructure

Implements ports and adapts external systems:

- Main: filesystem, network, persistence, database and repository implementations.
- Renderer: Preload/IPC gateways, DTO mappers, renderer cache and local persistence.

Infrastructure may depend on `contracts` and external libraries. It MUST NOT leak
those implementation details into domain APIs.

#### Presentation

Adapts the outside world into application use cases:

- Main: IPC handlers and response presenters.
- Renderer: React pages, components, stores, view models and routes.

Presentation validates/normalizes input, invokes application code and maps output for
the consumer. It should not contain persistence or authoritative business rules.

### Dependency direction

The default dependency direction is inward:

```text
Main presentation  ──→ application ──→ domain
Renderer presentation ─→ application ──→ domain
Infrastructure ────────→ declared ports/contracts
```

Strict prohibitions:

```text
domain          ✕ Electron, React, IPC, Node.js, database clients
application     ✕ concrete infrastructure and UI rendering
presentation    ✕ direct database/filesystem access
renderer        ✕ electron, ipcRenderer, fs, path, Node.js APIs
preload         ✕ domain implementation and broad privileged API exposure
context A       ✕ importing context B's internal files
```

Contexts communicate through public facades, application ports, explicit integration
services, domain events or `contracts`—never by reaching into another context's
private `domain`, `infrastructure` or `presentation` directory.

## 5. IPC and process-boundary rules

All cross-process communication follows:

```text
Renderer UI
  → Renderer gateway/service
  → window.desktopApi (Preload)
  → typed IPC channel
  → Main presentation handler
  → Main application use case
  → Main domain + infrastructure ports
```

Rules:

1. Define channel names and request/response DTOs in `src/contracts/ipc`.
2. Validate untrusted IPC input at the Preload/Main boundary.
3. Return DTOs, not domain entities, aggregate instances or database records.
4. Use allow-listed capability methods grouped by context, for example
   `window.desktopApi.workspace.list()`.
5. Do not pass functions, class instances, Electron objects, streams or opaque handles
   across IPC unless explicitly designed and documented.
6. Keep IPC handlers thin; they translate, invoke and present.
7. Keep channel constants in contracts; never duplicate string literals across Main,
   Preload and Renderer.

For the database capability, the only allowed Renderer-facing surface is the typed
`window.desktopApi.database.global` and `window.desktopApi.database.session` API from
`src/contracts/ipc/database.contract.ts`. It provides `get`, `set`, `delete` and `list`
for a key-value record. Do not expose SQL, paths, native handles or generic IPC
forwarders.

## 6. TypeScript type design

### General rules

- Prefer precise types over `any`; `any` requires a documented boundary justification.
- Use `unknown` for untrusted external values, then narrow or validate.
- Avoid non-null assertions (`!`) unless the invariant is obvious and local.
- Prefer discriminated unions for state and result variants.
- Use `readonly` for values that should not be mutated after creation.
- Keep DTOs serializable and free from methods/classes.
- Do not use a type assertion to hide a mismatch; fix the model or validate the value.

### Where types belong

- Cross-process request/response/event shape → `src/contracts`.
- Runtime-neutral primitive/shared abstraction → `src/shared`.
- Main business concept → owning Main context `domain`.
- Renderer interaction/view model → owning Renderer context `domain` or `presentation`.
- Infrastructure-only response from a concrete adapter → that adapter's module.
- React component props used only by one component → colocate with the component.
- Props reused across a feature → feature/context `presentation` types.

Never define the same IPC DTO independently in Main, Preload and Renderer.

### Recommended type forms

Use `interface` for extendable object contracts and public component props:

```ts
export interface WorkspaceDto {
  readonly id: string;
  readonly name: string;
}
```

Use `type` for unions, intersections, mapped types and function/result aliases:

```ts
export type LoadState<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'success'; readonly data: T }
  | { readonly status: 'error'; readonly error: Error };
```

Use `as const` for finite constant maps and derive unions from them:

```ts
export const workspaceChannels = {
  list: 'workspace:list',
  get: 'workspace:get',
} as const;

export type WorkspaceChannel =
  (typeof workspaceChannels)[keyof typeof workspaceChannels];
```

Use branded/value-object types only where they prevent a real class of bugs; do not
introduce nominal complexity for ordinary strings.

### Global Window API types

The exposed Preload API is declared once under `src/preload/types`, using global
augmentation. The declaration must match the actual `contextBridge.exposeInMainWorld`
object exactly. Renderer code consumes `window.desktopApi`; it does not redeclare it.

## 7. Export and import conventions

### Default rule: named exports

Use named exports for domain objects, application services, adapters, React components,
hooks and utilities:

```ts
export function listWorkspaces() {}
export interface WorkspaceGateway {}
export function Button() {}
```

Import them explicitly:

```ts
import { Button } from '@/components/ui/button';
```

Benefits: stable symbols, refactor-friendly imports and no ambiguity about a module's
public API.

### Default exports

Use a default export only where a tool or framework convention expects one, such as:

- Vite/Tailwind/PostCSS configuration files.
- A module whose sole public value is a configuration object and the convention is
  already established.

Do not use default exports for ordinary business modules or React components.

### Barrel files

Do not create broad `index.ts` barrels by default. Add a barrel only when it represents
an intentional public API for a context/package. A barrel MUST re-export public symbols
only; never expose another context's private implementation accidentally.

Avoid barrel cycles. Prefer direct imports within a context until a stable public
surface is needed.

### Import paths

- Renderer alias: `@/*` resolves to `src/renderer/*`.
- Prefer aliases for Renderer imports that cross directories.
- Use relative imports for tightly coupled files in the same small module when it is
  clearer.
- Main, Preload, contracts and root shared must not import from Renderer.

## 8. React, Tailwind and shadcn/ui rules

### React

- Use React 18 `createRoot` from `react-dom/client`.
- Keep `src/renderer/index.tsx` as a thin mount entry.
- Put providers, routes and global composition under `src/renderer/app`.
- Keep business workflows out of `App.tsx`; delegate to contexts.
- Prefer function components and named exports.
- Keep component props explicit and serializable where possible.
- Do not access Electron or Node.js APIs from React components.

### Tailwind

- Keep Tailwind on major version 3 unless the repository architecture is intentionally
  migrated and verified.
- Use design tokens from `src/renderer/styles/index.css` and semantic utilities such as
  `bg-background`, `text-foreground`, `border-border`, `text-muted-foreground`.
- Use `cn()` for conditional or overridable class names.
- Avoid arbitrary colors that bypass the theme unless the design explicitly requires
  them.
- Keep global styles and CSS variables in `styles/index.css`; do not scatter global
  resets across feature components.

### shadcn/ui

- `src/renderer/components/ui` contains copied, owned source components—not a black-box
  runtime package. It is valid to edit them when the product needs a behavior change.
- Use the configured `components.json` and existing shadcn conventions when adding a
  component.
- Keep reusable product-specific compositions outside `components/ui`, under the owning
  context's `presentation/components` or `src/renderer/components` when truly global.
- Do not put business workflows into generic UI primitives.
- Keep `cn()` in `src/renderer/lib/utils.ts` and do not duplicate class-merging helpers.

## 9. Naming and file conventions

- Folders and files: kebab-case (`workspace-gateway.ts`, `use-toast.ts`).
- React component files: kebab-case; exported component names: PascalCase.
- Hooks: `use-*.ts` or `use-*.tsx`.
- DTO suffix: `*.dto.ts` when a file contains DTO-specific definitions.
- Gateway/adapter suffix: `*-gateway.ts`, `*-adapter.ts`.
- Repository interface: `*-repository.ts` under domain/ports; implementation under
  infrastructure.
- IPC handlers: `*.handler.ts`; presenters: `*.presenter.ts`.
- Avoid vague names such as `common.ts`, `misc.ts`, `helpers.ts` for business code.
- Use `index.ts`/`index.tsx` as an entry only when the directory itself is the module
  boundary; do not make every file an `index` file.

## 10. Testing and verification

### Code quality toolchain

- Oxlint is the only JavaScript/TypeScript lint engine. Keep its rules in `.oxlintrc.json`
  and use `pnpm lint` or `pnpm lint:fix`; do not add legacy lint configs or CLI scripts.
- Prettier uses the repository-local `prettier.config.cjs` so formatting remains
  deterministic without depending on an external lint configuration package.
- Run `pnpm format` for deterministic source formatting. Generated output, dependencies
  and project documentation are excluded from linting.
- New lint exceptions MUST be narrowly scoped and include a reason. Do not disable a
  rule globally merely to make existing code pass.
- Renderer imports of `electron` and `node:*` are lint errors and MUST remain so.
- Commit messages MUST pass the local Conventional Commits rules in
  `commitlint.config.cjs`. Husky runs lint-staged at `pre-commit` and commitlint at
  `commit-msg`.
- Supported commit types are `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`,
  `refactor`, `revert`, `style`, `test`, `major` and `config`; headers are limited to
  72 characters.

Every behavior change or new feature should include tests at the lowest useful layer:

- Domain rules: unit tests without Electron/React.
- Application use cases: unit tests with explicit port fakes.
- Infrastructure/IPC: integration tests around adapters and contracts.
- Renderer components: focused component tests when behavior is non-trivial.
- User-critical flows: end-to-end tests where the test harness exists.

Before claiming work is complete, run the relevant fresh checks. For normal Renderer or
architecture changes, the minimum verification is:

```bash
corepack pnpm@10.34.5 format:check
corepack pnpm@10.34.5 typecheck
corepack pnpm@10.34.5 lint
corepack pnpm@10.34.5 test
corepack pnpm@10.34.5 package
```

If a check cannot run because the environment violates the repository engines, report
the exact versions and failure; do not claim success or silently change constraints.

## 11. Change discipline for agents

Before editing:

1. Read this file and the nearest `ARCHITECTURE.md`.
2. Inspect the existing context and its public entrypoints.
3. Identify the owning runtime boundary and bounded context.
4. Keep the change inside that boundary unless a contract or integration change is
   explicitly required.

During editing:

- Do not create speculative empty business contexts.
- Do not move code to shared merely to shorten an import.
- Do not add a new state library, UI kit or IPC abstraction without checking the current
  stack and explaining the need.
- Do not modify generated build output under `.vite` or packaged output under `out`.
- Preserve user changes and unrelated worktree modifications.

After editing:

- Search for stale imports and forbidden boundary violations.
- Verify new public APIs have a clear owner and export style.
- Run typecheck, lint and package checks appropriate to the change.
- Summarize any intentionally deferred test or migration work.

## 12. Anti-pattern checklist

The following are prohibited unless the task explicitly documents an exception:

- Renderer importing `electron`, `ipcRenderer`, `fs`, `path` or Node.js built-ins.
- Preload exposing the entire `ipcRenderer` object.
- Main domain importing Electron or concrete persistence clients.
- `better-sqlite3` imported outside `main/contexts/database/infrastructure`.
- Exposing database paths, SQL, prepared statements or native handles through Preload.
- Passing Main entities/classes directly over IPC.
- Duplicating channel strings or DTO definitions across processes.
- A giant global `shared` or `utils` folder containing unrelated business logic.
- Cross-context imports into private implementation directories.
- Default-exporting every module.
- `any` used to silence a type error.
- Putting business-specific components into `components/ui`.
- Adding a full DDD layer stack to a trivial static screen without a complexity reason.
- Claiming tests/build/lint pass without fresh command output.

When uncertain where code belongs, choose the narrowest owner that can satisfy the
dependency rules, and document the decision in the relevant context or an ADR.
