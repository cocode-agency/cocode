# AGENTS.md

Cocode 产品由三个 **同级目录** 组成：桌面/Web GUI、终端 TUI、Agent 运行时（harness）。本文件在 git 仓库根目录，覆盖整个工作区；各子目录有独立 pnpm workspace 与依赖。

## 仓库布局

```
./
  AGENTS.md           ← 本文件
  cocode-gui/         桌面 / Web GUI（含 .dev/guide、.dev/rfc）
  cocode-tui/         终端 TUI（含 .dev/rfc）
  cocode-host-supervisor/  DSH Host 生命周期与 runtime staging
```

不要在 GUI/TUI 目录中修改 DSH agent loop；Host 生命周期与 runtime staging 统一在 `cocode-host-supervisor/` 维护。

## 仓库边界

| 目录 | 职责 | 连 harness 的方式 |
| --- | --- | --- |
| **cocode-gui/** | 品牌 UI、设计系统、Host 客户端 | HTTP POST + 双 WebSocket → `dsh web` |
| **cocode-tui/** | 终端 UI、JSON-RPC 客户端 | stdio NDJSON-RPC → jsonrpc-agent 子进程 |
| **cocode-host-supervisor/** | DSH Host 生命周期、runtime staging、Cocode Host 插件 | — |

跨目录需求：上游 DSH 负责通用运行时能力，Cocode Host Supervisor 负责 Host 组合与
staging，GUI/TUI 侧消费 wire API；Cocode 产品行为统一落在 GUI 的插件包或 Host
插件中。

## cocode-gui/

```
cocode-gui/
  .dev/
    guide/               设计系统（design-system.html 为视觉权威）
    rfc/                 GUI 相关 RFC（pending/、implemented/）
  src/main.ts
  packages/
    connection/          Host 传输（@cocode/gui-connection）
    ui/                  设计令牌与 UI 基元（@cocode/ui）
```

**分层**：传输 → app 内 `runtime/`（会话状态，零 React）→ 呈现（React/Electron + `packages/ui`）。

`.dev/` 下除 `guide/`、`rfc/` 外的本地 scratch 不入库；RFC 写在 `cocode-gui/.dev/rfc/`，不要堆在仓库根。

```sh
cd cocode-gui
pnpm install
pnpm run dev          # Electron desktop client (default)
pnpm run dev:web      # browser-only, e.g. design-system.html
pnpm run typecheck
```

联调：`cd ../cocode-host-supervisor && pnpm dsh web`（默认 `http://127.0.0.1:3080`）。

Host 参考：`cocode-host-supervisor/packages/host-supervisor/`。

## cocode-tui/

```
cocode-tui/
  .dev/
    rfc/                 TUI 相关 RFC（pending/、implemented/）
  src/main.ts
  packages/
    connection/          JSON-RPC 传输（@cocode/tui-connection）
```

TUI 通过 `@deepseek-ai/dsh-sdk-client` 封装 spawn + `session.event` 流；技能/slash 走 `session.prompt` 文本路径。RFC 写在 `cocode-tui/.dev/rfc/`。

```sh
cd cocode-tui
pnpm install
pnpm run dev
pnpm run typecheck
```

Host 参考：`cocode-host-supervisor/packages/host-supervisor/`。

**不适用**：Host Supervisor 内的 terminal/runtime 工具不是 TUI 客户端。

## cocode-host-supervisor/

共享 DSH Host 生命周期与 runtime staging，规范见该目录的 README 和 package scripts。

```sh
cd cocode-host-supervisor
pnpm install && pnpm run build
pnpm dsh web          # GUI 联调
```

## DSH 定制分层（cocode-gui）

上游 DSH 客户端、Cordis 和相关运行时均通过 npm 依赖加载；仓库不保留 `packages/client` 或 `vendor` 源码快照。所有 Cocode 产品能力必须进 `cocode-gui/packages/cocode/*`，由 Electron `--patch` overlay 挂载（见 `createDshDesktopPatch`）。没有扩展点的内部洞才用 `patches/*.patch`（钉版本，上游合入即删）。

Overlay 与 runtime staging 代码只负责组合接线（禁用冲突的上游插件、插入 Cocode
插件、提供 transport/bootstrap）；不得在这些基础设施里复制产品 UI 或业务逻辑。

升级 DSH：直接 bump npm 版本并重新验证插件 ABI、runtime staging 和 Electron bundle；不要重新引入本地 DSH 源码快照或把产品 commit 叠到上游包里。

## 约定

- **包名**：GUI 用 `@cocode/gui-*`、`@cocode/ui`；TUI 用 `@cocode/tui-*`；harness 用 `@deepseek-ai/dsh-*`。
- **ESM**：`"type": "module"`；跨包用 package name，包内用 `.ts` 相对路径。
- **配置**：可变项走环境变量（见各目录 `.env.example`），禁止硬编码 harness 路径、模型、API Key。
- **密钥**：`.env` 不入库；key 只走 harness credentials。
- **模型可见 ⟺ 可重建**：UI 呈现态不进 session log。
- **构建产物不入库**：`cocode-gui/packages/cocode/*/lib/` 由 `pnpm build:cocode-plugins` 生成，只本地存在，不提交/推送。
- **pnpm store**：用默认全局 store（macOS：`~/Library/pnpm/store`）。禁止 `--store-dir .pnpm-store`，不要在仓库内创建 `.pnpm-store/`。
- **文件末尾**：恰好一个 trailing newline。

## 开发检查

| 改动 | 检查 |
| --- | --- |
| GUI 组件 / 令牌 | `cd cocode-gui && pnpm run dev:web` + `.dev/guide/design-system.html` 对照 |
| TUI 交互 | `cd cocode-tui && pnpm run dev` + JSON-RPC 联调 |
| DSH Host API | 先在 `cocode-host-supervisor/` 落地，再更新对应 `packages/connection` |

## 相关文档

- Host Supervisor：`cocode-host-supervisor/README.md`
- Host API / runtime staging：`cocode-host-supervisor/packages/host-supervisor/`
