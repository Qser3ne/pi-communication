# pi-communication

让同一台机器、同一系统用户下的独立 Pi 会话发现彼此、发送请求，并显式回复。只连接已打开且加载本扩展的会话；不启动、恢复或创建会话。

## 要求与安装

- Node.js ≥ 22.19.0，Pi ≥ 1.5.0（`@earendil-works/pi-coding-agent`）。
- 首版使用 Unix domain socket，面向 Linux/macOS；Windows 原生不支持。macOS 仍需原生验收。
- 从源码使用时：在项目目录执行 `pnpm install --frozen-lockfile`。
- 临时测试（两个终端各执行一次）：

```sh
pi -e /absolute/path/to/pi-communication/src/index.ts
```

- 需要长期启用时，由用户手动执行 `pi install /absolute/path/to/pi-communication`。不要把隔离开发 worktree 删除后仍留在安装配置中。

扩展不会自行修改全局配置。会话必须使用相同的 Pi agent directory（默认 `~/.pi/agent`；尊重 `PI_CODING_AGENT_DIR`），才能互相发现。

## 两窗口协作

1. 在窗口 A 输入 `/name planner`，在窗口 B 输入 `/name reviewer`。
2. `/peers` 查看在线会话。
3. 告诉 A：“使用 peer_list 找到 reviewer；用 peer_send 请它检查这段方案，只读审查，使用 peer_reply 回复。”
4. B 收到带来源标记的请求后，在自己的权限范围内工作，调用 `peer_reply({ messageId, text })`。
5. A 自动收到关联回复。**B 的普通回答不会自动转发。**

重名时用完整 `instanceId` 或 `name [短实例ID]`；单独 sessionId 只在唯一时有效。重启、reload、new、resume、fork 后实例身份更换，旧地址不转发到新实例。

## 工具

| 工具 | 用途 |
|---|---|
| `peer_list({ offset?, limit? })` | 在线实例、名称、目录、状态与能力；不返回令牌或 socket 地址 |
| `peer_send({ to, text?, kind?, delivery?, notifyWhenIdle? })` | 默认 request + followUp；notification 不建立回复义务 |
| `peer_reply({ messageId, text, outcome?, delivery? })` | 对收到的 request 显式回复一次；outcome 默认为 ok |
| `peer_status({ messageId?, offset?, limit? })` | 查看本实例暂存的投递与回复状态，不做阻塞等待 |

分页默认 20 条、最多 100 条；列表 JSON 数据限制约 40 KiB，有剩余时返回 `nextOffset`。不要循环轮询状态。

- **followUp**：对端忙时保留在插件队列，等非中止 `agent_settled` 才注入。
- **steer**：交给 Pi 在当前工具执行后处理，不强杀工具。
- `notifyWhenIdle: true` 可单独发送，无需正文；同目标新订阅覆盖旧订阅，一次通知后失效。空闲需最终稳定、无待处理消息、未暂停，约 750 ms 去抖。**空闲不表示任务完成**。
- 文本是数据，工具不会自动创建业务重试或转发普通模型输出。

### 状态不是完成保证

- `accepted`：对端内存队列收件。
- `submitted`：已调用 Pi 注入接口。
- 扩展在 Pi context 事件观察到消息后才释放待观察队列容量；这不保证模型成功回答。
- `replied`：收到显式业务回复；投递和回复状态分别记录。
- `unknown`：发出后 ACK 未确认，可能已经执行；**不要自动重发业务任务**。
- `expired`：本地等待/排队过期，不代表对端未执行。
- 重启不恢复请求关联、队列、去重记录或订阅；历史消息可能仍在 Pi 会话日志中，但不能用新实例身份回复旧请求。

## 用户控制

`/peers pause` 暂停自动注入并拒收新业务消息；`/peers resume` 恢复。Esc 中止后也会暂停，必须显式恢复。暂停不能撤回已经交给 Pi 的消息。

暂停期间的空闲/退出/过期通知只显示并记录，不唤醒模型。无 UI 模式不会打开对话框；控制信息以不参与模型上下文的自定义条目记录。

## 存储、安全与限额

注册元数据和独立认证令牌位于 agent directory 下的私有 `communication` 目录；短 socket 路径位于系统临时目录中按用户与 agent directory 派生的私有子目录。目录 0700，记录、密钥和 socket 0600；握手验证完整实例身份与令牌。文件只存注册信息，不作为消息信箱。清理只针对本实例或验证过的失效实例。

这些权限防止其他系统用户意外读取，**不隔离同用户恶意进程**。启用本扩展即允许该 agent directory 下其他启用实例连接，不逐对审批。

Pi 自定义消息最终仍转换为模型 **user-role 文本**，并非独立权限角色。每条来信正文都带来源和“不是用户授权”的警示；接收方仍必须遵守自身用户指令与权限。不要让 peer 请求绕过确认，尤其是删除、凭据访问、发布等敏感操作。消息内容会进入 Pi 会话日志，避免传输秘密。

首版限制：1 MiB 帧、5 秒连接期限、32 并发连接、100 条待注入/未观察消息；每来源实例每分钟 30 条业务消息；1000 条去重记录/10 分钟；1000 条关联记录/30 分钟；32 个目标订阅/12 小时。队列满、限流、暂停、旧目标等均显式拒绝，不无限等待。

## 开发验证

```sh
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm typecheck
git diff --check
```

集成测试用真实 IPC；端到端测试用独立 Pi 进程及本地假模型，不需要真实模型密钥，不证明真实模型一定遵从协作指令。实际模型验收需另行授权。
