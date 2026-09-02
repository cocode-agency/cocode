# Cocode 快捷键能力设计与实施方案

- 状态：Implemented baseline / P1 partial
- 日期：2026-08-15
- 范围：cocode-gui 的 Cocode shortcuts 插件、Renderer 运行时和 Electron Main bounded context
- 关联：cocode-gui/.dev/rfc/implemented/2026-08-14-gui-plugin-architecture.md、main_backup 分支旧实现、cocode-workbench / cocode-account 本地插件包

## 1. 结论摘要

快捷键属于 Cocode 的本地产品能力，不属于 Agent runtime 或 TUI 能力。当前采用三层实现：

1. cocode-shortcuts 本地 DSH 插件：注册设置命名空间、自有受信任 settings route、命令目录、Renderer 快捷键分发和设置 UI。
2. Electron Main shortcuts bounded context：只负责全局快捷键的注册、注销、IPC 校验和触发转发。
3. cocode-shortcuts settings namespace：保存用户覆盖，不保存命令函数或完整命令目录。

当前已经实现的命令：

| commandId | 默认组合 | 默认范围 | 全局能力 |
| --- | --- | --- | --- |
| cocode.sidebar.toggle | Cmd/Ctrl+B | app | 否 |
| cocode.newSession | Cmd/Ctrl+N | app | 是，用户可切换为 global |

当前明确的存储决策：

- 存储在 DSH settings namespace cocode-shortcuts。
- 默认按当前本地 DSH settings profile 隔离，不按登录客户隔离。
- Main 只维护当前进程中的 Electron 注册状态，不另存一份快捷键配置。
- 全局快捷键必须同时满足命令声明能力和 Main 内置 allowlist，不能由设置数据直接执行任意命令。

## 2. 从 main_backup 到当前实现

main_backup 主要提供了三个原型：

- ShortcutRegistry：Renderer 内的按键匹配与触发。
- ShortcutApi / Electron globalShortcut：桌面全局快捷键。
- ShortcutsSettings：快捷键列表展示。

当前方案保留了原型的有效职责，但按现有 Cocode 架构重新分层：

| 原型能力 | 当前归属 | 变化 |
| --- | --- | --- |
| Renderer 按键匹配 | cocode-shortcuts/src/client/registry.ts | 从组件级监听提升为插件级 registry |
| 全局快捷键 | src/main/contexts/shortcuts | Main 拥有 OS 能力，Renderer 只提交同步请求 |
| 快捷键设置 | ShortcutsGeneralItem.tsx 的独立 settings section | 从只读展示变为录制、重置、禁用和范围切换 |
| 配置持久化 | DSH settings cocode-shortcuts | 只保存用户 binding 覆盖 |
| 命令定义 | Client plugin command catalog | 用稳定 commandId 连接设置、Renderer 和 Main |

## 3. 当前架构

~~~text
DSH Host plugin
  cocode-shortcuts/src/index.ts
  -> register settings namespace: cocode-shortcuts
  -> register plugin-owned trusted settings route

DSH Client plugin
  cocode-shortcuts/src/client/index.tsx
  -> create ShortcutRegistry
  -> register Cocode commands
  -> install window keydown capture listener
  -> inject settings.section (cocode-shortcuts)

Renderer                      Preload                  Electron Main
effective keymap
  -> desktopApi.shortcuts.sync()
                               -> IPC schema validation
                                                        -> ShortcutService
                                                        -> globalShortcut

globalShortcut callback
  -> webContents.send(shortcuts:triggered, commandId)
  -> registry.execute(commandId)
~~~

### 3.1 职责边界

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| Host 半区 | settings namespace 注册、自有 settings route、请求信任校验 | 不运行 Renderer 命令或 UI |
| Client 半区 | 命令注册、组合键匹配、设置 UI、全局 keymap 同步 | 不直接调用 Electron |
| Preload | 窄 IPC bridge、入出参 schema 校验 | 不持久化、不决定命令权限 |
| Electron Main | OS 全局注册、sender 校验、注册失败回滚、触发转发 | 不解析 Renderer when 逻辑 |
| DSH settings | 提供最终 settings 持久化和 revision | 不拥有快捷键业务规则或账号 profile |

### 3.2 插件自有 settings route

`cocode-shortcuts` 不修改 Harness 的 apiproxy allowlist，也不依赖通用 settings wire API。Host 插件在自身生命周期内注册：

~~~text
/cocode/shortcuts/api/settings.get
/cocode/shortcuts/api/settings.update
~~~

route 只代理 `cocode-shortcuts` 自己的 settings namespace：

- Host 通过 `ctx.settings.register("cocode-shortcuts", schema)` 注册命名空间。
- `settings.get` 返回 `value`、可选 `user/base`、`revision` 和 `writable`。
- `settings.update` 只接受 `version`、`bindings` 和 `expectedRevision`，写入使用 DSH settings 的 revision 检查。
- revision 冲突返回稳定错误码 `settings-conflict` 和 HTTP 409，客户端随后重新读取 Host 状态。
- route 仅接受 POST；只允许 loopback 或 DSH 明确的 trusted host，并拒绝跨站请求。
- JSON body 限制为 64 KiB，未知方法、字段、commandId 和 Combo 字段均拒绝。
- route 不暴露其他 settings namespace、secret、文件路径、会话内容或任意命令执行能力。

Electron 和 Browser carrier 都调用同一 route。Browser route 不可用时，Client controller 只在尚未成功读取远端状态的情况下使用进程内 memory fallback；一旦远端成功连接，后续写入失败不会伪装成已持久化。

## 4. 已实现能力

### 4.1 插件与装配

新增本地插件包：

~~~text
cocode-gui/packages/cocode/cocode-shortcuts/
  src/index.ts                    Host half
  src/settings.ts                 settings schema and namespace
  src/route.ts                    plugin-owned settings route
  src/trust-fence.ts              loopback / trusted-host fence
  src/wire.ts                     bounded JSON wire helpers
  src/client/index.tsx            Client half and command catalog
  src/client/registry.ts          command/keymap registry
  src/client/combo.ts             Combo normalization and matching
  src/client/settings-api.ts      route transport
  src/client/settings-controller.ts revision-fenced settings controller
  src/client/ShortcutsGeneralItem.tsx  settings UI and recorder
~~~

已接入：

- dsh-desktop.patch.yml 的 Electron-only plugin overlay。
- local-dsh-client-bundles.ts 的本地 client bundle 映射。
- package.json 的 build:cocode-plugins。
- Preload desktopApi.shortcuts。
- Main application ready / before-quit 生命周期。
- Cocode 插件自己的 `/cocode/shortcuts/api/settings.get|settings.update` route。

### 4.2 Renderer 快捷键

事件路径：

~~~text
window keydown(capture)
  -> 忽略 defaultPrevented / IME composition / keyCode 229
  -> 忽略文本输入框、contentEditable 和 xterm，除非命令显式允许
  -> 按 app scope 匹配 Combo
  -> command.when（当前只有可用的函数钩子，尚未注册复杂上下文）
  -> command.run(event)
  -> 命中时 preventDefault + stopPropagation
~~~

旧 sidebar.tsx 中的硬编码 Cmd/Ctrl+B 监听已经移除，侧栏切换的唯一来源是 cocode.sidebar.toggle 命令。

### 4.3 设置 UI

入口使用已有 `settings.section` 槽位，不修改设置壳：

- 在设置面板左侧目录显示独立的“快捷键”页面，位于“模型”之后、“插件”之前。
- 进入页面后直接展示快捷键列表，不再通过 General 行内展开。
- 支持录制组合键。
- Escape 取消录制。
- Backspace 将绑定设置为禁用。
- 支持重置为命令默认值。
- 对允许全局注册的命令支持 app/global 切换。
- 显示冲突和 orphan binding 状态。

当前 UI 尚未实现搜索、分类、批量恢复默认和冲突解决向导。

### 4.4 Electron 全局快捷键

ShortcutService 的约束：

- 只接受当前主窗口的 IPC sender。
- 只允许 cocode.newSession 注册为 global。
- 对重复 accelerator 和非 global-capable command 拒绝同步。
- 只注销变化的 accelerator。
- 新 accelerator 注册失败时恢复旧注册，避免出现半更新状态。
- 应用退出时注销由服务持有的注册。
- OS 触发后只向 Renderer 发送稳定 commandId，不携带 payload。

## 5. 数据模型与持久化

### 5.1 实际持久化模型

实现使用平台无关的 Combo 对象，而不是直接保存 Electron accelerator 字符串：

~~~json
{
  "version": 1,
  "bindings": {
    "cocode.sidebar.toggle": {
      "combo": {
        "key": "b",
        "primary": true
      }
    },
    "cocode.newSession": {
      "combo": {
        "key": "n",
        "primary": true
      },
      "scope": "global"
    },
    "cocode.some-command": {
      "disabled": true
    }
  }
}
~~~

字段约定：

- commandId 是稳定键，不能用标题作为 key。
- combo 保存平台无关的 key、primary、control、alt、shift。
- primary 在 macOS 显示为 Cmd，在 Windows/Linux 显示为 Ctrl。
- scope 只有 app / global，global 还必须通过命令能力和 Main 内置 allowlist。
- disabled: true 表示显式禁用。
- 用户只覆盖自己修改过的 binding；默认命令目录由插件代码提供。
- 已保存但当前没有对应命令的 key 会进入 orphaned，当前 UI 只提示，尚未提供清理按钮。

### 5.2 存储位置

实际存储位置是：

~~~text
DSH settings document
  namespace: cocode-shortcuts
~~~

Host 半区通过 settingsNamespace("cocode-shortcuts") 注册 schema，并通过插件自己的 fenced route 读写；route 内部调用 `ctx.settings`，最终仍由 DSH settings 写入当前 DSH_HOME 下的 settings.yaml。

因此，当前实现不是独立的 shortcuts.json，也不是 Electron Main 的 SQLite 表；Main 不持久化配置。

“设备级”需要精确定义：当前是当前 DSH settings profile 级。如果一台机器只使用一个 DSH home/profile，它表现为设备级；如果多个 profile 指向不同 settings 文件，则自然按 profile 隔离。

快捷键没有独立的 shortcuts.json，也没有 Electron Main 的第二份持久化副本。插件自有 route 是访问协议，DSH settings 是存储层，两者职责分离。

## 6. 登录客户隔离建议

### 6.1 当前推荐

首版不按登录客户隔离，理由是：

- 快捷键是操作者的输入习惯，不是客户业务数据。
- 切换登录客户不应导致键盘行为突然变化。
- 账号 token、会话内容和快捷键偏好属于不同安全域。
- 当前账号切换生命周期没有与快捷键 profile 切换的完整原子协议，提前引入会增加状态竞态。

因此当前边界是：

~~~text
同一 DSH settings profile -> 共享快捷键
不同 DSH settings profile -> 隔离快捷键
不同登录客户但同一 profile -> 不隔离
~~~

### 6.2 未来需要客户隔离时

推荐使用稳定的服务端 accountId，不要使用 email：

~~~text
cocode-shortcuts
  profiles
    <accountId>
      bindings
~~~

切换流程必须是原子操作：

1. 阻止新的 global sync。
2. 注销旧 profile 的 global shortcuts。
3. 读取并校验新 profile 的 bindings。
4. 计算有效 keymap。
5. 完成 Main 注册后再切换 UI 当前 profile。
6. 注册失败时保留旧 profile，不显示“已切换但快捷键失效”。

不建议现在把 accountId 直接写入现有 flat bindings，因为这会改变 schema、迁移旧配置，并把本地偏好和账号生命周期强耦合。

## 7. 冲突、安全与兼容策略

### 7.1 当前已实现

- Renderer 侧按 comboId 做基础 catalog 冲突检测。
- 禁止无修饰的单字符快捷键。
- 拒绝 Cmd/Ctrl+Q 和 Cmd/Ctrl+W。
- IME 组合期间不触发。
- 输入框、contentEditable、xterm 默认不触发 app shortcut。
- IPC request 的 commandId、accelerator、bindings 数量有 schema 限制。
- Main 对 IPC sender 做主窗口校验。
- Main 只接受显式允许的全局命令。

### 7.2 当前尚未实现

- 不能探测所有操作系统保留组合，只能依赖 Electron globalShortcut.register 的失败结果。
- UI 显示冲突，但不会自动把旧命令移回默认值，也没有“强制覆盖”流程。
- when 尚未接入设置打开、模态框、命令面板、终端焦点等完整上下文。
- 没有跨设备同步，也没有账号级云端同步。

推荐的后续冲突策略是“先阻止保存，再由用户明确选择覆盖”，不要静默覆盖其他命令：

~~~text
录制新组合
  -> catalog 冲突检查
  -> 有冲突：显示占用命令 + 覆盖 / 取消
  -> 无冲突：写入 settings
  -> global：Main 再做 OS 注册检查
  -> OS 失败：恢复旧 keymap，保留旧设置
~~~

## 8. IPC 契约

实际契约位于：

- src/contracts/ipc/shortcuts.contract.ts
- src/contracts/schemas/shortcuts.schema.ts
- src/preload/bridges/shortcuts.bridge.ts

核心数据：

~~~ts
type GlobalBindingDto = {
  readonly commandId: string
  readonly accelerator: string
}

type SyncShortcutsRequest = {
  readonly bindings: readonly GlobalBindingDto[]
}

type ShortcutsApi = {
  sync(request: SyncShortcutsRequest): Promise<SyncShortcutsResult>
  onTriggered(listener: (commandId: string) => void): () => void
}
~~~

Renderer 将 Combo 转为 Electron 的 CommandOrControl+... 字符串只用于 IPC，不写入 settings。浏览器或非 Electron carrier 没有 desktopApi.shortcuts 时，registry 仍可运行 app scope；当前仓库的正式运行载体是 Electron。

## 9. 需要产品决策的内容

以下内容不应在实现阶段隐式决定：

| 决策问题 | 选项 | 推荐 | 原因 |
| --- | --- | --- | --- |
| 快捷键是否按登录客户隔离 | A. 不隔离；B. accountId 隔离；C. 本地默认 + 账号可选 profile | A | 保持操作者习惯稳定，当前架构也只需要 profile 级设置 |
| 是否同步到云端 | A. 永不同步；B. 跟随 Settings Sync；C. 单独开关 | C | 本地默认安全，用户明确开启后再跨设备同步 |
| 哪些命令允许 global | A. 任意注册命令；B. 命令声明 + Main allowlist；C. 全部仅 app | B | 保持扩展性，同时不把 Renderer 命令权限直接交给设置数据 |
| 冲突时如何保存 | A. 后注册覆盖；B. 自动改旧命令；C. 阻止保存并让用户确认 | C | 可预测、可恢复，不产生静默行为变化 |
| 是否把快捷键能力下沉到 Harness/TUI | A. 现在共享；B. 只保留 GUI；C. 先定义跨端 command contract 再共享 | B | TUI 当前没有同一窗口/OS global 语义，提前共享会制造错误抽象 |
| 设置入口形态 | A. General 行内展开；B. 独立设置页；C. Command Palette | B | 快捷键是成组的操作能力，独立页面更容易扩展、检索和理解 |

## 10. 实施计划

### P0：已完成，最小可用闭环

- [x] 新增 cocode-shortcuts Host/Client 插件包。
- [x] 注册 cocode-shortcuts settings namespace。
- [x] 实现 Combo 规范化、默认值、用户覆盖、禁用和重置。
- [x] 迁移侧栏 Cmd/Ctrl+B，移除组件内旧监听。
- [x] 设置面板左侧目录中的独立快捷键页面。
- [x] 接入 Electron Main IPC 和全局 cocode.newSession。
- [x] 增加插件自有 fenced settings route，不修改 Harness。

### P1：已完成基础能力，仍需产品化

- [x] IME、文本输入框、contentEditable、xterm 保护。
- [x] 基础冲突检测和 orphan 识别。
- [x] Main 差量注册、注销和失败回滚。
- [x] global/app 范围切换。
- [ ] 完整 when 上下文表达式。
- [ ] 冲突阻止保存和覆盖向导。
- [ ] 搜索、分类、批量恢复默认。
- [ ] 真实 Electron/browser smoke test。

### P2：扩展能力

- [ ] 更多 Cocode 命令：设置、命令面板、会话导航等，前提是现有架构提供可复用公开服务。
- [ ] accountId profile 隔离。
- [ ] 可选 Settings Sync / 云端同步。
- [ ] 为 GUI 与 TUI 定义跨端 command contract；在此之前不修改 cocode-tui。
- [ ] 允许其他本地 DSH Client 插件通过公开 registry API 注册命令，而不是依赖 Cocode shortcuts 包的内部实现。

## 11. 验收标准

### 11.1 已通过的自动化验证

- cocode-shortcuts typecheck。
- cocode-shortcuts build。
- cocode-shortcuts focused tests：4 files / 15 tests passed。
- GUI 全量测试：40 files / 491 tests passed（包含 ShortcutService、schema、transport）。
- Harness apiproxy settings test：30/30（验证 Harness 没有快捷键相关修改）。
- `build:cocode-plugins`：sidebar、account、shortcuts 均构建通过。
- targeted ESLint。
- git diff --check。
- pnpm install --frozen-lockfile --offline --lockfile-only。

### 11.2 尚未完成的运行时验收

需要在真实 Electron + DSH runtime 中确认：

1. 设置面板左侧目录能看到并打开“快捷键”。
2. Cmd/Ctrl+B 只触发一次侧栏切换。
3. 修改和重置后重新启动仍能读到 settings。
4. cocode.newSession 切换为 global 后，窗口失焦仍能触发。
5. OS 已占用快捷键时 UI 不会显示成已生效。
6. DSH runtime 重启或窗口重建后旧 global registration 不残留。

### 11.3 当前验证限制

- 尚未进行真实 Electron/browser UI smoke test。
- 完整 pnpm run lint 仍受分支已有的 account 文件格式问题影响，非本次快捷键改动引入。
- 完整 staging 需要访问 npm registry，当前受沙箱网络限制；插件自身的 staging 验证已通过。

## 12. 变更清单

### 新增

~~~text
cocode-gui/packages/cocode/cocode-shortcuts/
cocode-gui/src/contracts/ipc/shortcuts.contract.ts
cocode-gui/src/contracts/schemas/shortcuts.schema.ts
cocode-gui/src/preload/bridges/shortcuts.bridge.ts
cocode-gui/src/main/contexts/shortcuts/
cocode-gui/tests/main/shortcuts/
~~~

### 修改

~~~text
cocode-gui/package.json
cocode-gui/pnpm-lock.yaml
cocode-gui/src/contracts/ipc/desktop.contract.ts
cocode-gui/src/main/bootstrap/start-application.ts
cocode-gui/src/main/contexts/dsh-runtime/infrastructure/dsh-desktop-patch.ts
cocode-gui/src/main/shell/windows/create-main-window.ts
cocode-gui/src/preload/index.ts
cocode-gui/src/renderer/app/bootstrap/local-dsh-client-bundles.ts
cocode-gui/src/renderer/components/ui/sidebar.tsx
~~~

### 当前不修改

~~~text
cocode-tui/
cocode-host-supervisor/（本次最终状态无修改）
设置壳 core
~~~

## 13. 参考

- cocode-gui/.dev/rfc/implemented/2026-08-14-gui-plugin-architecture.md
- cocode-gui/packages/cocode/cocode-workbench
- cocode-gui/packages/cocode/cocode-account
- cocode-gui/src/main/contexts/database
- cocode-gui/src/contracts/ipc/account.contract.ts
- main_backup:cocode-gui/src/runtime/shortcuts/registry.ts
- main_backup:cocode-gui/electron/main.ts
