# Cocode

**开箱即用的 DeepSeek Harness 发行版。**

[English](README.md) · [简体中文](README.zh.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

大多数编码 Agent 替你把选择做完之后，也把选择权一起收走了：能用哪些工具、怎么调度、
界面长什么样，都由上游定好。Cocode 想做的是另一半——替你做完选择，但把螺丝刀留在你
手边。默认那份装好就能用，不用先研究底下有什么；不称手的时候，你能打开它、看清它是
怎么拼起来的，然后照自己的想法改。这是 Cocode 全部设计的出发点。

底下的运行时是 DeepSeek Harness。它有它自己的主张——一切都是插件：模型、工具、
技能、会话、沙箱和调度都靠配置拼装，它不替你决定该拼出什么。Cocode 拼好了其中一份，
并且把这份组装摊开在产品里，而不是藏进配置文件。

> **项目状态：** 开发者预览版。Cocode 基于 DeepSeek Harness 开发者预览版构建，是独立
> 发行版，不是 DeepSeek 官方产品，上游仍可能出现兼容性变化。仓库支持在 macOS、Windows
> 和 Linux 上进行源码构建；当前发布脚本面向 macOS 和 Windows 安装包，本仓库不包含
> 托管后端，也不包含 Harness 的 vendored 副本。

## 安装方式与五分钟上手

| 场景 | 安装 | 启动 |
| --- | --- | --- |
| **GUI** | 从 [GitHub Releases](https://github.com/cocode-agency/cocode/releases) 下载对应平台安装包。 | 打开 Cocode，然后选择 Cocode Nut 或自己的 DeepSeek 兼容 Key。 |
| **TUI** | Node.js `22.19.x` 或更高版本（也支持 `24+`），执行 `npm install --global @cocode-agency/tui`。 | 先执行 `cocode doctor`，再执行 `cocode`；需要真实终端。 |
| **源码开发** | 按下面各组件的 pnpm 说明安装。 | 使用 `make dev gui` 或 `make dev tui`。 |

发布版 TUI 会自动安装匹配版本的 `@cocode-agency/host-supervisor`。每次发布时，
`@cocode-agency/tui` 与 `@cocode-agency/host-supervisor` 必须保持同一版本线，不要混用不同发布版。
GUI 安装包从对应的 GitHub Release 单独下载，不通过 npm 安装。本仓库当前仍是开发者
预览版，发布内容和上游 Harness 兼容性可能变化。

### 五分钟完成第一次运行

1. 从 GitHub Releases 安装 GUI，或执行 `npm install --global @cocode-agency/tui`。
2. 打开 GUI；或者在真实 TTY 中依次执行 `cocode doctor`、`cocode`。
3. 选择 Cocode Nut，或输入自己的 DeepSeek 兼容 API Key。
4. 打开一个工作区，让 Agent 检查一个文件或解释项目。
5. 如果启动失败，保存 `cocode doctor` 和 `cocode host status --json` 的输出用于排查。
   分享前请删除凭证和私有会话内容。

---

## 为什么是 Cocode

**Agent 本身是可以拆开的。** 一个会话用哪些工具、什么提示词、开哪些能力，是一份叫
「预设」的插件组装，界面上直接就能查看它的 `agent.cordis.yml`。内置标准、PTC、极简和
创造四种，复制一份改成自己的即可。别处你能换的是模型，这里你能换的是 Agent 本身。

**一个工作台，不是一个聊天框。** 文件、Git、终端、内置浏览器和 diff 预览与会话在同一
个界面里。Agent 改了什么、跑了什么，你在旁边就能看见，也能随时自己接手，不用在几个
窗口之间来回搬运上下文。

**桌面和终端接得上同一条会话。** GUI 和 TUI 连的是同一个 Host，读写同一份会话记录。
白天在桌面推进的任务，出门 SSH 上去用终端接着做——因为界面呈现态从不写进会话日志，
换个客户端也能把整条对话完整重建出来。

**模型也是你选的。** DeepSeek 官方 Key、任何 OpenAI 兼容的自建或网关端点，或者直接用
Cocode 自己的模型服务 Cocode Nut——三条路都在，随时切换。

Cocode 不打算做成又一个聊天窗口，不会把完整思维链当成卖点摆给你看，也不会默认把所有
工具都放开给模型。它想成为的，是一个你敢把真实工作放进去、并且能按自己的样子改的
工作台。

## 两个入口，同一个会话

| | |
| --- | --- |
| **Cocode GUI** | 基于 Electron 的桌面工作台。会话、文件、终端和运行时状态在同一个界面里，代码 diff 与附件在预览面板中打开，确认之前就能看清改了什么。 |
| **Cocode TUI** | 面向键盘流和远程场景的终端客户端。SSH 上去就能继续推进任务，不需要图形环境。 |

两者通过 `@cocode-agency/host-supervisor` 接到同一个 Host；只有使用相同的 `DSH_HOME`、profile
和 Host 配置作用域时，才会共享会话与任务状态。在同一作用域内从桌面端切换到终端，
不会让工作重来一遍。

### Cocode GUI

[![Cocode 桌面工作台中的 DeepSeek Harness 会话](https://cocode.agency/product/gui-screenshot.webp)](https://cocode.agency/#gui)

### Cocode TUI

[![Cocode 终端界面中的 DeepSeek Harness 会话](https://cocode.agency/product/tui-screenshot.webp)](https://cocode.agency/#tui)

## 仓库结构

这个仓库不是单一 workspace。三个组件各自是独立的 pnpm workspace，有各自的 lockfile
和工具链，由根目录的 `Makefile` 串起来。

```text
cocode/
├── cocode-gui/               # Electron 桌面 / Web GUI  (@cocode/gui-root)
├── cocode-tui/               # 终端客户端                (@cocode-agency/tui)
├── cocode-host-supervisor/   # 共享 DSH Host 生命周期     (@cocode-agency/host-supervisor)
├── Makefile                  # 根级开发快捷命令
└── AGENTS.md                 # 面向贡献者与 agent 的工程约定
```

运行时本身不在这里。`@cocode-agency/host-supervisor` 从 npm 固定依赖 `@deepseek-ai/dsh`，
并负责 Supervisor 服务、本地 IPC 与 lease 协议、运行时槽位物化，以及 Cocode 的
JSON-RPC Host 插件。GUI 和 TUI 自己不启动 Harness 进程——它们为一个规范化的
`DSH_HOME + profile + Host 配置` 作用域申请 lease，然后连到 Host 广播出来的端点。

```text
Cocode GUI ─┐
            ├─→ @cocode-agency/host-supervisor ─→ @deepseek-ai/dsh (npm) ─→ 模型 · 工具 · 会话
Cocode TUI ─┘
```

## 环境要求

三个组件的工具链基线并不统一，按你要构建的那个来：

| 组件 | Node.js | pnpm |
| --- | --- | --- |
| `cocode-gui` | `>=22.12.0`（见 `.nvmrc`） | 精确 `10.34.5` |
| `cocode-tui` | `^22.19` 或 `>=24` | 任意较新版本 |
| `cocode-host-supervisor` | `>=22.12.0` | 任意较新版本 |

## 快速开始

下面的目标都在仓库根目录执行。

```sh
# 桌面工作台：Electron 客户端 + Vite，端口 5273
make install-gui
make dev gui

# 终端客户端（需要 TTY；preflight 会装依赖并在必要时刷新 Host 运行时）
make install-tui
make dev tui

# 纯浏览器 GUI，适合调设计系统
make dev gui-web

# 单独跑 Host，用于调试 wire 协议
make install-dsh
make dev dsh
```

直接执行 `make` 会列出所有目标。

### `cocode` 命令

安装 TUI 或桌面版后，`cocode` 是统一入口。没有子命令时保持原行为，直接打开 TUI；GUI、TUI 和 Host 管理使用同一组环境变量，因此不同端可以访问同一个 Host 作用域。

```sh
cocode --version                 # 查询安装版本
cocode gui                       # 打开 GUI
cocode tui                       # 打开 TUI
cocode host status               # 查询共享 Host，不会启动 Host
cocode host status --json        # 输出机器可读状态
cocode host stop                 # 无活动客户端时停止 Host 和 Supervisor
cocode host stop --force         # 明确中断仍持有 lease 的 GUI/TUI 客户端
cocode doctor                    # 检查 TUI、Supervisor 和 Host 能否联通
```

`--dsh-home <path>`、`--profile <name>` 和 `--runtime-channel stable|preview|dev` 可以放在子命令前或后，用来选择需要管理的 Host 作用域。跨平台无法自动定位 GUI 时，设置 `COCODE_GUI_EXECUTABLE`（也支持别名 `COCODE_GUI_PATH`）指定 GUI 可执行文件。

GUI 会复用系统缓存目录里已暂存的运行时。缓存过期时有两个逃生口：

```sh
DSH_FORCE_RESTAGE=1 make dev gui          # 刷新缓存
DSH_DISABLE_RUNTIME_CACHE=1 make dev gui  # 隔离运行时，不走缓存
```

### 构建安装包

```sh
make gui-build      # 当前平台的 Electron Forge 安装包
```

GUI 的发布构建统一使用平台和架构参数：

```sh
cd cocode-gui
corepack pnpm@10.34.5 run release -- --platform darwin --arch arm64
```

原有的 `release:<platform>:<arch>` 命令暂时保留为兼容别名，供已有自动化流程使用。

GUI 是私有的 Electron workspace，而不是 npm 应用包。TUI 和 Host Supervisor 已配置公开
发布流程，但从 registry 安装前，应只使用同一个 GitHub Release 和 npm 发布中的匹配版本。

## 模型接入

Cocode 不内置模型，也不绑定某一家。第一次打开时它只问你一件事：**用 Cocode Nut，
还是用你自己的 Key。** 两条路都能留在这台机器上，随时切换。

### Cocode Nut：不用去申请 API Key

Cocode Nut 是 Cocode 自己的模型服务。注册登录就能在桌面端和终端里直接调模型，不用
去申请 Key、保管 Key，也不用每换一台设备再配一次。

- **有免费档，可以直接试。** 不用先付钱，跑通了再决定要不要加额度。
- **$10 / 月，最多可用价值 $60 的模型额度。** 实际能跑多少取决于你用哪个模型，不是
  一个固定数额。模型跑在我们自建的 B300 集群上，不经第三方转售，所以同样的钱能多跑
  不少任务。
- **DeepSeek V4 Pro 和 V4 Flash。** 免费档只用 Flash，付费档两个都能用。
- **一份额度，两个入口共用。** 桌面端和终端花的是同一份，不用分开管。
- **你的代码不会被拿去训练。** 提示词、代码和模型返回不用于训练、不出售给第三方，
  除完成调用、计费和必要排障外不留存请求内容。

最新套餐、额度窗口和账单入口以 [cocode.agency/nut](https://cocode.agency/nut) 为准，
随时可以升级或取消。身份令牌存在 `~/.cocode` 下的 `account.yaml`，推理用的个人 Key
交给 Host 凭据服务管理，两者都不会进入会话日志。

### 自带 Key

已经有 DeepSeek API key 的话，首次启动直接粘贴即可。Cocode 本来就是 DeepSeek Harness
的发行版，完全在本地跑通不附加任何条件。Key 存在 `$DSH_HOME` 下的 DSH 凭据文件里，
同样不会进入会话日志。

相关环境变量：`DSH_HOME` 和 `DSH_PROFILE` 决定共享 Host 的作用域，
`COCODE_HOST_CONFIG_FINGERPRINT` 用于固定自定义 Host 组合，`COCODE_HOME` 隔离
Cocode 凭据，`DSH_SESSION_ROOT` 用于迁移会话文件位置。

## 文档

| | |
| --- | --- |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 贡献流程、检查项和改动边界 |
| [`SECURITY.md`](SECURITY.md) | 漏洞报告流程 |
| [`cocode-tui/docs/`](cocode-tui/docs/) | TUI 用户指南，含中英文 |
| [`cocode-host-supervisor/README.md`](cocode-host-supervisor/README.md) | Supervisor lease 协议与客户端 API |
| [`cocode-gui/README.md`](cocode-gui/README.md) | GUI 开发、打包和更新行为 |
| [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) | 第三方来源与许可证说明 |

产品文档见 [doc.cocode.agency](https://doc.cocode.agency)。

## 参与贡献

先读 [CONTRIBUTING.md](CONTRIBUTING.md)——里面说明了提交信息规范、哪些检查是必须的，
以及改动如何在三个组件之间划分范围。请将改动限制在对应组件内，不要提交本地运行时、
缓存、凭据或生成产物。

报告安全漏洞请走 [SECURITY.md](SECURITY.md) 的流程，不要开公开 issue。

## 许可证

[MIT](LICENSE) © 2026 Cocode Agency。

第三方组件（包括 DeepSeek Harness 和以源码形式内置的 Cordis 框架）各自保留其许可证，
详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

---

[cocode.agency](https://cocode.agency) · [文档](https://doc.cocode.agency) · [下载](https://cocode.agency/download) · [Cocode Nut](https://cocode.agency/nut)
