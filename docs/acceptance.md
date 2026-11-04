# 验收记录

日期：2026-11-04。环境：Ubuntu 24.04.5 / x86_64，Node 22.23.4，pnpm 12.3.4，Pi SDK/CLI 1.5.0。只使用临时 agent directory 和临时工作目录；无个人会话、真实 API key 或付费模型调用。

## 自动化分层

| 命令 | 验证内容 |
|---|---|
| `pnpm test:unit` | 协议/边界/权限/注册/队列/限流/关联/状态乱序/空闲/工具/UI；34 个用例 |
| `pnpm test:integration` | 独立 Node 进程、真实 UDS、认证、分帧、ACK 丢失、收件后关停、空闲通知；10 个用例 |
| `pnpm test:e2e` | 真实 Pi RPC 与真实 Pi TUI、loopback 假模型、打包入口；6 个用例 |
| `pnpm typecheck` | TypeScript 与已安装 Pi API 类型检查 |
| `git diff --check` | 补丁空白检查 |
| `pnpm pack --pack-destination /tmp/pi-communication-pack` | 归档仅含 manifest、README、src；无 .pi、token、注册表、日志或测试 |

逐层命令已执行；总计 50 个用例通过。打包测试重新生成归档、检查每个路径、解包，然后以临时 agent directory 加载包目录，验证 manifest 入口与 `/peers` 可用。最终审查若增加回归用例，以最新测试输出为准。

### 真实 Pi RPC

- A 假模型调用 `peer_list`、`peer_send`。
- B 没有收到额外用户输入，自动启动，调用 `peer_reply`。
- A 收到且仅收到一次关联回复；身份、replyTo、处理次数均断言。
- 可控慢 bash 工具运行期间，followUp 不注入；steer 不杀工具，工具副作用仅一次。完成后先处理 steer，再处理 followUp。
- clear_queue + abort 模拟 Esc：插件待处理消息不自动续跑；显式 resume 后才处理；中止工具不产生完成副作用。
- 同名、同 sessionId 双实例消歧；new_session、switch_session、fork、退出、重启均验证实例身份更换。
- 支持 Pi 自定义 session ID（例如 `review.session-42`）；仅 instance UUID 用作私有文件名。

### 双 PTY 交互模式

`tests/fixtures/tui-smoke.py` 启动两个真实交互 Pi 终端（不是 RPC），执行并断言：

`/name` → `/peers` → 自动请求/回复与来源文本渲染 → `/reload` → `/new` → `/resume` 选择 → `/fork` 选择 → 慢工具中 Esc → `/peers resume` / `pause` → 双 Ctrl+C 正常退出。

验证注册身份变化、暂停状态、来信/回复文本与退出后的注册清理。**这是自动化 PTY 交互验收，不是人工视觉签收**。端到端测试需要 Python 3、POSIX PTY 与 tar。

### 故障窗口

- 真实 socket 在收件后、ACK 前断开：返回 unknown，计数为 1，不重发。
- 真实监听器在收件回调未完成时关闭：发送者 unknown，新连接 unavailable，计数仍为 1。
- submitted 回执先于发送 ACK、终态 expired 后迟到 submitted、reply 先于发送 ACK：不把状态倒退为 accepted。
- 运行时关闭保留队列、注入异常、重复关闭、启动中关闭：不启动新的模型任务或留下可发现的幽灵实例。

## 未验证项及边界

- macOS 是目标平台，但未在原生 macOS 运行。对系统 `/tmp → /private/tmp` 规范化有模拟测试，不能替代原生验收。
- 未验证 Windows 原生，且首版明确不支持。
- 未进行真实模型协作测试；假模型证明调度和协议链路，不证明模型一定正确理解权限、选择工具或完成业务。
- 未由人眼检查完整主题、终端 resize、所有字体/终端组合；窄宽度/宽字符由真实 Text 组件单测覆盖。
- 不验证隔离同用户恶意进程。此插件的认证与文件权限不是同用户沙箱。
- SIGKILL 后残留记录不被发现，但不承诺删除所有历史垃圾文件；不做跨重启恢复。

## 可复现命令

```sh
pnpm install --frozen-lockfile
pnpm test:unit && pnpm test:integration && pnpm test:e2e && pnpm typecheck && git diff --check
```

测试日志为开发工作区临时产物，不打包。RPC 脱敏事件与 PTY 输出位于 `.superpowers/sdd/2026-11-04-peer-communication/e2e/`（实施工作区清理后不保留）。
