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

## 行为档案

`docs/archive/` 是当前行为的唯一档案位置；以下链接指向源码仓库内文档。

| capability | 范围 |
|---|---|
| [peer-discovery](docs/archive/peer-discovery/archive.md) | 在线发现、名称消歧、实例生命周期与注册目录 |
| [peer-messaging](docs/archive/peer-messaging/archive.md) | 四个工具、请求/回复、分页和状态含义 |
| [peer-delivery-control](docs/archive/peer-delivery-control/archive.md) | followUp/steer、暂停恢复、队列及限流 |
| [peer-idle-notification](docs/archive/peer-idle-notification/archive.md) | 一次性空闲订阅、期限和退出通知 |
| [peer-security](docs/archive/peer-security/archive.md) | 本地传输、私有存储、来源展示与权限边界 |

使用前请重点阅读投递状态和权限边界；工具说明不是对远端业务完成的保证。

## 已知问题

很多不响应的注册实例可能延长退出或工具取消等待；控制消息的 1 秒关闭期限目前不是硬上限，因为全注册表探测尚不可中途取消。此项不作为保证写入档案，保留在验收记录中跟踪。

## 开发验证

```sh
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm typecheck
git diff --check
```

Linux 验收记录见 [docs/acceptance.md](docs/acceptance.md)（源码仓库内）。端到端测试还需要 Python 3、POSIX PTY 和 tar。

集成测试用真实 IPC；端到端测试用独立 Pi 进程及本地假模型，不需要真实模型密钥，不证明真实模型一定遵从协作指令。实际模型验收需另行授权。
