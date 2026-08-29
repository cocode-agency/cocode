# RFC：把 `packages/client` 产品改动抽成 Cocode 插件（落地 handoff）

- 状态：落地完成，待二次审查
- 日期：2026-08-28
- 范围：`cocode-gui/packages/client` 快照恢复、`packages/cocode/*` 新产品插件、Electron overlay、Host Supervisor `--patch`、Renderer `file://` loopback
- 审查目标：确认产品能力已离开 DSH 快照、插件挂载正确、没有双轨实现、没有漏抽或误抽

本文件给后续模型做审查用。它记录已经落地的设计、实现位置、已知缝和未跑过的验证，不是一份待实现的方案。

## 1. 摘要

Cocode 产品改动禁止再写进 `packages/client`（上游 DSH 客户端快照）。本轮把仍留在快照里的产品行为抽到 `packages/cocode/*`，由 Cordis overlay 挂载；抽完后删除快照里的产品实现，不保留 deprecated 双轨。

本轮新增四个插件：

| 插件 | 职责 |
|---|---|
| `cocode-appearance` | 外观设置整节、消息字号、`--cocode-*` 令牌覆盖 |
| `cocode-desktop` | 无 trigger 的设置壳、titlebar 拖拽、藏 composer Stats、运行时恢复条 |
| `cocode-message-feedback` | 消息反馈走 `desktopApi.account` |
| `cocode-models` | Models 设置页 + Cocode Nut account-gate |

此前已存在、本轮只继续挂载的插件：`cocode-workbench`、`cocode-account`、`cocode-shortcuts`、`cocode-brand`、`cocode-input-history`。`cocode-dsml` 是 Host 侧包，不在 Web client roster。

**刻意留下的缝**：`ui-layout` 仍声明 `workbench.right` / `workbench.bottom`，由 `cocode-workbench` 占用。整包 overlay-replace layout 过大，本轮不做。

## 2. 架构铁律（审查时以此为准）

1. `packages/client` 是上游快照。新产品进 `packages/cocode/*`。
2. 产品走 Cordis overlay，不把整份 `packages/client` 打成 pnpm patch。
3. `patches/*.patch` 只留给没有扩展点的内部洞。
4. 同一 cell 的 list/single slot shadowing：不同 `priority`，**最低数字赢**。品牌与本轮产品占用一律 `priority: -1`。
5. shadow `sidebar.settings` 时**不要**再声明 `children`；DSH `ui-settings-general` 已声明，重复会 throw。
6. 不要 disable `ui-theme`。AppearanceRow 用 shadow 藏。`installThemeStyles` 必须留在快照里。
7. disable `ui-settings-models` / `ui-message-feedback` 是整行（host+client）。这两包 host `apply` 本来就是空的。
8. 插件脚手架照 `cocode-brand`：`package.json` `0.1.0-cocode.0`，`dsh.client.platform: web`，host `src/index.ts` 空 `apply`，client `src/client/index.ts` re-export `index.tsx`，`tsconfig.build.json` 排除 `src/client/index.ts`。
9. `lib/` 不入库。
10. 真正跑起来的 overlay 是 Host Supervisor 的 `createRuntimePatch()`，不是 GUI 里的 `createDshDesktopPatch()`。两者必须同时包含 disable 行。

## 3. 已完成的工作

### 3.1 新产品插件

路径都在 `cocode-gui/packages/cocode/`。

#### `cocode-appearance`

- `src/client/index.tsx`：注入 `tokens.css?inline`；shadow `settings.general.item` id `appearance` priority `-1`（空组件，藏 DSH AppearanceRow）；注册 `settings.section` id `appearance` order `5`。
- 字号：`localStorage` key `cocode.message.fontSize`，写 CSS 变量 `--dsw-conversation-message-font-size`。conversation CSS 读取该变量是合法 seam，插件负责赋值。
- 主题切换仍调用 `ctx.theme.setTheme`。字号不再进 Host settings document，只留在 localStorage。
- 依赖：`clsx` 已写入 peer/devDependencies。

#### `cocode-desktop`

- 产品版 `SettingsRoot`：无 DSH footer trigger；`window` 事件 `cocode:open-settings`；nav 图标含 appearance / shortcuts；`data-settings-panel`。
- shadow `sidebar.settings` priority `-1`，**不声明 children**。TypeScript 用 `as never` 绕过 SlotMap（slot 类型在 sidebar 侧没有 inject face）。审查时确认运行时仍能拿到 DSH 声明的 children。
- shadow `conversation.composer.dock` id `stats` priority `-1`，藏 StatsLine。DSH `ui-conversation` 仍注册 StatsLine，产品用更低 priority 盖住。
- `shell.overlay` 上挂 `RecoveryBanner`（id `cocode-recovery`）。
- `mountTitlebar()`：50ms 轮询，把 `[data-desktop-titlebar-drag]` 插到 frame 第一个子节点（sidebar col），并打 `data-cocode-sidebar`。
- `chrome.module.css`：titlebar 拖拽、sidebar inset、设置面板打开时禁用 conversation / session-header 的 `-webkit-app-region: drag`。

#### `cocode-message-feedback`

- 从快照 `ui-message-feedback` 复制产品版；`account.ts` 走 `window.desktopApi.account`。
- overlay **disable** 上游 `ui-message-feedback`，避免同一 `conversation.chat.assistant-actions` id `feedback` 双注册。
- `MessageFeedbackController.reset()` 是本轮加的：账号登出/登入时清缓存。上游 controller 没有这个方法。

#### `cocode-models`

- 从快照 `ui-settings-models` 复制带 account-gate 的产品版。
- overlay **disable** 上游 `ui-settings-models`。
- 测试已迁入插件：`tests/account-gate.client.spec.ts`、`tests/provider-tag.client.spec.ts`。

### 3.2 快照恢复（`packages/client`）

已从快照删掉或写回上游形态的产品点：

| 原产品改动 | 快照现状 |
|---|---|
| connection `file://` 也算 loopback | 恢复为只看 `isLoopbackHostname(hostname)` |
| 藏 StatsLine 注册 | 恢复 DSH `conversation.composer.dock` id `stats` |
| ThemePresenter 写消息字号 | 删除 `MESSAGE_FONT_SIZE_VARIABLE` |
| AppFrame `--cocode-accent` 拖拽条 | 改回 `--dsw-alias-interactive-bg-primary` |
| AppFrame `RuntimeRecoveryBanner` | 组件和 CSS 已删 |
| Appearance 整节 + 字号进 ThemeRuntime | 恢复 AppearanceRow；删 `AppearanceSection.*` |
| `design-platform.css` / think gradient `--cocode-*` | 恢复 DSH 调色板 |
| 反馈走 account | 恢复 `ctx.remote.messageFeedback`；删 `account.ts` |
| Models account-gate | 删 `account-gate.ts` 及相关测试；store 去掉 managed |
| Settings 壳无 trigger / event / extra icons / `data-settings-panel` | 恢复带 trigger 的 DSH 壳 |
| Settings 面板暗色 `#101012` | 快照里已去掉；产品 CSS 在 `cocode-desktop` |
| Sidebar titlebar DOM/CSS | 已删 |
| Conversation `data-settings-panel` 拖拽覆盖 | 已迁到 `cocode-desktop` chrome CSS |

产品文件禁止清单（测试会断言不存在）：

`cocode-gui/tests/main/dsh-runtime/dsh-client-product-delta.test.ts`

### 3.3 Overlay / Renderer 挂载

**真正生效的 overlay**（Supervisor 启动 Host 时写入 slot 的 `cocode-host.patch.yml`）：

`cocode-host-supervisor/packages/host-supervisor/src/runtime.ts` → `createRuntimePatch()`

当前会：

```yaml
- id: ui-message-feedback
  disabled: true
- id: ui-settings-models
  disabled: true
- insert:
    - id: cocode-credentials   # 有凭据兼容层时
    - id: cocode-host-jsonrpc
    - id: <每一个 staged runtime/plugins 目录名>
```

staged 插件来自 `runtime/plugins/*`。新包只要被 `build:cocode-plugins` 构建并 stage 进 Supervisor，就会自动 insert。审查时不要只看 GUI helper 的静态名单。

**GUI 侧静态名单**（测试 / 文档 / Electron helper，当前**没有**被 spawn 路径调用）：

`cocode-gui/src/main/contexts/dsh-runtime/infrastructure/dsh-desktop-patch.ts` → `createDshDesktopPatch()`

这里也写了同样的 disable + 显式 insert 名单。如果只改一边，审查应判为漂移。

其它接线：

| 文件 | 作用 |
|---|---|
| `src/renderer/app/bootstrap/local-dsh-client-bundles.ts` | `file://` 下把插件 id 解析到 `./dsh-client/cocode/<id>/client.js` |
| `src/main/contexts/dsh-runtime/infrastructure/dsh-runtime-health.ts` | `REQUIRED_COCODE_WEB_CLIENTS` 含 9 个产品可见 client |
| `src/renderer/app/bootstrap/file-loopback-hostname.ts` | `file://` 时把 `Location.prototype.hostname` 伪装成 `127.0.0.1` |
| `src/renderer/app/bootstrap/start-renderer.ts` | `startRenderer` 里、加载 DSH 图之前调用 spoof |

`file://` spoof 的原因：`isLoopback` 在 connection 插件 `apply()` 时读死。overlay 插件太晚，不能事后改。必须在 Renderer 启动最早阶段伪装 hostname。

### 3.4 文档

`packages/cocode/ARCHITECTURE.md` 已改成「产品在 `packages/cocode`」，并写明 workbench dock 槽位仍由 vendored layout 声明。

## 4. 关键实现细节（审查易踩坑）

### 4.1 为什么 disable models / feedback，却只 shadow Appearance / Settings / Stats

- **整包替换**：`ui-settings-models`、`ui-message-feedback` 的产品差异贯穿 store / remote / 文案，shadow 单个 occupant 不够，且同 id 双注册会炸。host apply 为空，disable 整行安全。
- **不能 disable `ui-theme`**：会丢掉 `ThemeRuntime` 和 `installThemeStyles`。所以 AppearanceRow 用 priority `-1` 的空 occupant 藏起来，再由 `cocode-appearance` 注册自己的 `settings.section`。
- **不能 disable `ui-settings-general`**：General 分区、trigger/header/close 槽位、onboarding coordinator 仍由它声明。`cocode-desktop` 只替换 `sidebar.settings` 的根组件。
- **不能 disable `ui-conversation`**：Stats 只是 composer dock 的一个 occupant。DSH 继续注册 StatsLine，产品用 priority `-1` 的 `HiddenStats` 盖住。

### 4.2 `sidebar.settings` 的 `as never`

`ui-sidebar` 的 SlotMap 把 `sidebar.settings` 标成无 inject / 无 children 的 single slot。真正的 children 和 inject 是 `ui-settings-general` 在 register 时声明的。产品 shadow 需要 inject、但不能重复 children，所以 options 被断言为 `never`。

审查应确认：

1. 运行时 DSH `ui-settings-general` 仍然先声明 children。
2. 产品 SettingsRoot 仍能 `renderSlot('settings.section' | 'settings.onboarding' | ...)`。
3. 没有第二个 register 再声明同一组 children。

### 4.3 Titlebar 挂载是 DOM 探测，不是 slot

`mountTitlebar` 找 `[data-shell-overlay]` 的父节点的第一个子节点，假定那是 sidebar 列。这依赖 `AppFrame` 的 DOM 顺序。layout 若重排，拖拽条会挂错列。

轮询 50ms，成功后 clearInterval。卸载时 remove strip。

### 4.4 字号不再进 Host settings

抽插件后字号只在 `localStorage`。升级前如果用户把字号写进了 DSH settings document，新实现不会读那个字段。这是有意简化（新项目一次性到位），审查若认为要迁移，应单独提，不要塞回 ThemeRuntime。

### 4.5 双 overlay 源

| 源 | 谁用 | 插件名单怎么来 |
|---|---|---|
| `createRuntimePatch` | Supervisor 实际 `--patch` | `runtime/plugins/*` 目录扫描 + 固定 disable |
| `createDshDesktopPatch` | 目前只有 GUI 单测 | 手写 insert 名单 + 同样的 disable |

审查必须确认两边的 **disable 列表一致**。insert 名单可以不同：Supervisor 会插入所有 staged 插件（含 `cocode-dsml` 这类 Host 包，只要它在 `runtime/plugins`）。GUI helper 只列 Web 产品插件。

### 4.6 健康检查 vs 实际 boot

`REQUIRED_COCODE_WEB_CLIENTS` 现在是：

```
cocode-workbench
cocode-account
cocode-shortcuts
cocode-brand
cocode-input-history
cocode-appearance
cocode-desktop
cocode-message-feedback
cocode-models
```

Host 的 `__DSH_BOOT__` 必须能广告这些 id。若 Supervisor insert 了但 client bundle 没打进 `dsh-client/cocode/<id>/`，Renderer 会 404。

`local-dsh-client-bundles.ts` 仍映射被 disable 的 `@deepseek-ai/dsh-client-ui-message-feedback` / `ui-settings-models`。它们不应再出现在 boot manifest；留下映射无害。

## 5. 未做 / 已知剩余

1. **workbench dock 槽位仍在 vendored `ui-layout`**。诚实抽法是 overlay-replace 整个 `ui-layout`。本轮不做，ARCHITECTURE.md 已写明。
2. **没有 Electron 端到端验证**。未在真实 Desktop 窗口里点：侧栏拖拽、外观字号、Nut 锁定、反馈、快捷方式图标、`file://` 设置面、恢复条。
3. **没有跑完整 DSH 快照 vitest**（`packages/client` 在 GUI 仓库没有 workspace vitest 入口）。改过的快照测试文件已按上游合同改过，但未在本轮执行。
4. **`createDshDesktopPatch` 未被 spawn 调用**。运行时只认 Supervisor patch。GUI helper 可能是历史文档面，审查可建议删掉或改成单一事实源。
5. **SettingsRoot.module.css 在 desktop 插件里仍含 `.trigger` 规则**，组件已不渲染 trigger。死 CSS，不影响行为。
6. **AppFrame 仍接收 `locale` prop**（layout inject 还在传），组件已不使用。为保持 inject 合同而留下。
7. **sidebar 快照注释**仍提到 `cocode-brand` 填品牌洞。这是扩展点说明，不是产品实现。
8. **未 git commit**。按用户规则本轮不提交。

## 6. 审查清单

请按下面顺序核对，不要只看插件目录是否存在。

### 6.1 快照里不能再有产品实现

在 `packages/client` 搜索并确认**没有**这些实现（测试文件除外）：

- `AppearanceSection`
- `account-gate`
- `agencyMessageFeedbackRemote` / `ui-message-feedback/src/client/account.ts`
- `CocodeLogo` / `logo-settings` / `hero-logo-store`
- `RuntimeRecoveryBanner`
- `--cocode-` token（`design-platform.css` / `gradient-shadow-text.css`）
- connection `protocol === 'file:'` 判定
- `cocode:open-settings`（应只在 `cocode-desktop`）
- `data-desktop-titlebar-drag`（应只在 `cocode-desktop`）
- Models `managedProvider` / `HostedProviderGate`（应只在 `cocode-models`）

允许留下的 seam：

- `--dsw-conversation-message-font-size`（conversation CSS 读取，appearance 赋值）
- `workbench.right` / `workbench.bottom` 槽位声明
- DSH StatsLine 注册（被 HiddenStats shadow）
- DSH AppearanceRow 注册（被 HiddenAppearanceRow shadow）

### 6.2 插件是否真的挂上

- Supervisor `createRuntimePatch` 含 `ui-message-feedback` / `ui-settings-models` 的 `disabled: true`。
- `REQUIRED_COCODE_WEB_CLIENTS` 与 `local-dsh-client-bundles.ts` 覆盖四个新插件。
- 新插件 `package.json` 有 `dsh.client.platform: web`，否则 watch/stage 不会当 client 打。
- `tsconfig.build.json` 排除 `src/client/index.ts`，避免和 `index.tsx` 双入口。

### 6.3 运行时行为

- 设置从账号 footer 打开，sidebar 底部没有第二颗 DSH Settings 按钮。
- 外观是独立 section，General 里没有 DSH AppearanceRow。
- 未登录时 Models 不把 Cocode Nut 显示成可手改的健康供应商。
- 未登录时反馈控件不可用 / 走 account 错误，而不是 harness messageFeedback Remote。
- composer 没有 Stats 行。
- macOS 侧栏顶部可拖窗口；设置面板打开时 conversation 顶部按钮可点。
- 打包 `file://` 仍能打开设置（loopback 伪装生效）。
- 主题 token 是 Cocode 调色板，而不是恢复后的 DSH 默认色（appearance tokens 必须在 DSH `installThemeStyles` 之后注入）。

### 6.4 不要误伤

- `ui-theme` 仍启用，`installThemeStyles` 仍跑。
- `ui-settings-general` 仍启用，General 其它行、onboarding 步骤还在。
- `ui-conversation` 仍启用。
- 不要把 `packages/client` 整包改成可发布的产品 fork。

## 7. 已跑过的验证

在 `cocode-gui/`：

```sh
corepack pnpm@10.34.5 install
corepack pnpm@10.34.5 run typecheck:cocode-plugins
corepack pnpm@10.34.5 run test:cocode-plugins
corepack pnpm@10.34.5 --filter cocode-appearance --filter cocode-desktop --filter cocode-message-feedback --filter cocode-models run build
corepack pnpm@10.34.5 run test:host-supervisor
```

以及 node:test：

```
tests/main/dsh-runtime/dsh-desktop-patch.test.ts
tests/main/dsh-runtime/dsh-client-product-delta.test.ts
tests/main/dsh-runtime/dsh-runtime-bootstrap.test.ts
tests/renderer/dsh-client-bundle-path.test.ts
tests/renderer/file-loopback-hostname.test.ts
tests/renderer/message-font-size.test.ts
tests/renderer/message-feedback-account.test.ts
tests/renderer/sidebar-settings-visibility.test.ts
```

结果：上述全部通过。四个新插件 `lib/client.js` 已能构建（appearance 打进了 tokens CSS，desktop 打进了 titlebar / open-settings，models 打进了 cocode-nut / managedProvider）。

未跑：Electron 手工/浏览器 E2E、完整 `packages/client` vitest、`pnpm run typecheck` 全仓。

## 8. 建议审查命令

```sh
cd cocode-gui

# 快照里不该再有产品实现
rg -n "AppearanceSection|account-gate|agencyMessageFeedbackRemote|RuntimeRecoveryBanner|--cocode-|cocode:open-settings|data-desktop-titlebar-drag" packages/client

# 真实 overlay
rg -n "ui-message-feedback|ui-settings-models" ../cocode-host-supervisor/packages/host-supervisor/src/runtime.ts

# 双名单是否同步 disable
rg -n "disabled: true" src/main/contexts/dsh-runtime/infrastructure/dsh-desktop-patch.ts ../cocode-host-supervisor/packages/host-supervisor/src/runtime.ts
```

发现问题时优先改 `packages/cocode/*` 或 overlay，不要把产品逻辑写回 `packages/client`。
