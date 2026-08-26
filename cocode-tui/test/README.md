# TUI 测试编写规范

本目录的测试按运行边界分层。测试名称必须准确反映它证明了什么，不能把 mock runtime、内存流渲染或 `--doctor` 结果称为端到端验证。

## 测试层级

| 层级 | 目录或入口 | 允许替换的边界 | 主要断言 |
| --- | --- | --- | --- |
| 纯逻辑单元测试 | `test/runtime/`、`test/connection/` | 外部依赖都可以替换 | 输入输出、状态转换、异常分类 |
| Ink 集成测试 | `test/present/` | runtime 可以替换，stdin/stdout 可以使用内存流 | 键盘和鼠标路由、可见文本、组件状态 |
| Host E2E | `test/e2e/**/*.e2e.ts` | 只允许替换模型提供方的网络端点 | 真实 CLI、Supervisor、Host、JSON-RPC、事件顺序和持久化 |
| PTY 验收 | 独立 PTY 测试或人工终端 | 模型端点可以固定，终端进程不能替换 | ANSI 输入输出、光标、窗口尺寸、退出和中断 |
| 真实环境 Smoke Test | release 或 nightly | 不替换账号、模型或终端 | 发布包和线上运行时是否可用 |

普通测试使用：

```sh
pnpm test
```

Host E2E 使用：

```sh
pnpm run test:e2e
```

`test:e2e` 会先构建同级 `cocode-host-supervisor`，然后运行独立的 Vitest 配置。E2E 文件使用 `.e2e.ts` 后缀，避免被普通 `pnpm test` 收集。

## Host E2E 的必要边界

Host E2E 必须同时满足以下条件：

1. 通过 `bin/cocode-tui.mjs` 启动真实 CLI 子进程。
2. 使用真实 `@cocode-agency/host-supervisor` 构建产物。
3. 由 Supervisor 启动真实 DSH Host。
4. 通过真实 JSON-RPC socket 执行 `initialize`、workspace、prompt 和通知流程。
5. 不替换 `createHostSupervisorClient()`、`connectJsonRpc()` 或 JSON-RPC peer。
6. 每个测试组使用独立的 `COCODE_HOME`、`COCODE_DSH_HOME`、`COCODE_SUPERVISOR_HOME`、`COCODE_HOST_RUNTIME_HOME`、`COCODE_LOG_ROOT` 和 session 目录。

模型提供方可以使用本地 fixture server。fixture 只负责提供确定性的模型响应，不得直接生成 `session.event`，否则测试会绕过需要验证的 Host 行为。

## 断言规范

端到端测试不能只断言退出码或最终出现 `idle`。一个成功回合至少验证：

1. CLI 退出码为 `0`，结构化结果为 `completed`。
2. fixture server 确实收到预期 provider、model 和用户 prompt。
3. 事件日志包含 assistant 内容和 `turn/end`。
4. 顺序满足 `running → turn/end → idle`。
5. session JSONL 包含用户 prompt、assistant 内容和终止事件。

错误场景至少验证：

1. CLI 返回非零退出码和用户可识别的错误。
2. `turn/end.reason` 保留上游错误语义。
3. 错误回合不能在 `turn/end(error)` 之前进入 `idle`，CLI 不能把 `idle` 当作成功判据。
4. 失败记录仍然进入 session 持久化。

工具场景应优先验证真实副作用，例如文件内容或命令结果，不能只断言界面显示了工具完成。

## 稳定性要求

- 不比较完整 ANSI 帧，不把动态 spinner、光标位置、耗时或 token 数作为固定快照。
- 对事件验证使用语义字段和必要的相对顺序，不固定所有非业务事件的数量。
- prompt、session id、fixture response 使用清晰且可搜索的唯一标记。
- 网络 fixture 只监听 `127.0.0.1` 和随机端口，不使用开发者已有服务。
- Unix 平台的临时根目录必须足够短，避免 Supervisor 和 Host socket 超过 Unix domain socket 路径上限；macOS 默认使用 `/tmp`，可以通过 `COCODE_E2E_TMP_ROOT` 覆盖。
- 测试结束时显式停止 Host，并删除测试创建的临时目录。
- 不读取或写入开发者真实的 `~/.cocode`、`~/.dsh`、credentials 或 session。
- E2E 超时必须终止 CLI 子进程，并在错误中输出已捕获的 stdout/stderr。

## 变更时的覆盖要求

修改以下行为时，应同步添加或更新对应测试：

| 改动 | 最低测试要求 |
| --- | --- |
| 事件映射、`turn/end`、状态切换 | 单元测试 + Host E2E |
| JSON-RPC method、参数或 capability | connection 测试 + Host E2E |
| session 创建、恢复、持久化 | runtime 测试 + Host E2E |
| approval、question、tool 副作用 | runtime 测试 + Host E2E；交互变化再补 PTY |
| 键盘、鼠标、光标、清屏和 resize | Ink 集成测试 + PTY 验收 |
| 发布入口、Supervisor 或 runtime 打包 | release check + Host E2E + 手动真实终端 Smoke Test |

## 验证结果的表述

测试报告需要分别说明以下边界是否执行：

- 纯逻辑；
- Ink 内存流；
- connection 协议；
- CLI 子进程；
- 真实 Supervisor 和 Host；
- PTY；
- 真实 TTY；
- 原生 Windows、Linux、macOS；
- 真实账号和模型。

未执行的边界写「未验证」，不能由相邻层级推断为通过。

## 补充 E2E 场景路线

按上游后置行为对用户可见结果的影响排序，后续场景逐个落地：

| 优先级 | 场景 | 主要验证 | 状态 |
| --- | --- | --- | --- |
| P0 | 同一 session 的连续 CLI 回合 | session 持久化、恢复和第二次 prompt 的事件边界 | 已实现 |
| P1 | 工具调用产生真实文件副作用 | tool call、审批策略、命令结果和持久化 | bash 文件副作用已实现 |
| P1 | question / approval 交互 | JSON-RPC request-response、取消和终止状态 | question、approval 已实现 |
| P1 | provider HTTP 500、断流和 malformed SSE | 网络失败映射、退出码、`turn/end(error)` 和持久化 | HTTP 500/502、断流、malformed SSE 已实现 |
| P2 | CLI 中断和超时 | SIGINT、Host 清理、session 状态和残留进程 | 超时已实现；SIGINT 待实现 |
| P2 | PTY 真实终端验收 | ANSI、resize、退出和中断 | 待实现 |
