# Pi 独立会话通信设计

状态：用户已于 2026-11-04 批准；不是实现计划。文中“建议”是批准时接受的首版约定。
日期：2026-11-04

## 1. 目标与已确认边界

让同一台机器上已经打开的独立 Pi 会话自主发现彼此、发送消息、处理来信并显式回复。双方保留各自上下文，不要求用户复制转发。

用户已确认：
- 只处理已打开的独立会话，不创建子会话，不启动或恢复历史会话。
- 同一系统用户下，所有已启用插件的会话可以相互发现与通信，不分组、不逐对审批。
- 发送方选择投递时机：默认等对方当前运行结束，也可以尽快插入。
- 参考 Esonhugh/claude-code 的独立会话通信实现。
- 最新架构选择为 Socket 直连，取代此前选择的中央中转服务。

以下是设计建议，尚未单独获得批准：第一版只支持 Linux/macOS 的本地 Unix socket；使用内存队列、不跨重启恢复、不自动重做任务；显式请求/回复关联；一次性空闲通知；接收暂停与限流。批准本设计后这些成为第一版约定。

成功标准：在两个真实 Pi 进程中，A 发现 B、发送请求，B 自动看到带来源的来信并用工具回复，A 自动收到关联回复；忙时投递、断开、重名和会话切换都有明确行为。

## 2. 非目标与反目标

第一版不提供跨机器、Windows named pipe、广播、团队编排、共享完整历史、流式 token 转发、后台守护进程、离线信箱或持久任务系统。

明确不能发生：把来信冒充用户授权；自动转发无关回答；把已写入 socket 宣称为任务完成；自动重试导致重复副作用；切换会话后将旧消息交给新上下文；通过阻塞等待造成双方互锁。

## 3. Approaches：方案选择记录

| 方案 | 优点 | 代价 | 决策 |
| --- | --- | --- | --- |
| 文件信箱 | 无服务、易检查、自然保留消息 | 扫描补偿、文件并发和清理 | 未采用 |
| Socket 直连 + 文件注册表 | 无中心进程、低延迟、与参考实现一致 | 地址发现、生命周期、逐连接认证 | 用户最终选择 |
| 本地中转服务 | 集中路由、便于订阅和监控 | 服务生命周期和中央故障点 | 用户先选择，研究参考项目后改选直连 |

文件注册表只保存在线身份、地址和认证资料，不承担消息队列。会话历史中留有消息文本，不代表能恢复投递状态。

## 4. 参考实现及取舍

参考仓库：https://github.com/Esonhugh/claude-code
分析版本：52e581686c3cca4279497e28351cb029958f407f。
主要依据：docs/features/peer-messaging.md、src/utils/{concurrentSessions,udsClient,udsMessaging,peerProtocol,peerNotices}.ts，以及 SendMessageTool 和 udsMessaging.test.ts。

保留思想：私有本地 IPC、注册表发现、显式发送和回复、独立来源标记、内存去重、有限队列、异步状态回执、一次性空闲订阅。

有意不同：
- 不复制其 Claude permission class 比较机制；Pi 插件不假设存在等价权限模式。接收会话已有的权限扩展继续生效。
- 不兼容其 wire protocol，也不与 Claude 会话互通。
- 增加 replyTo，使业务回复明确关联原请求。
- 显式验证目标 sessionId 和运行实例 instanceId，防止旧地址误投。
- 强制认证握手，不保留 Unix 无认证旧帧兼容路径。
- 增加发送方可选的 followUp / steer；默认不打断接收方运行。
- 对端入队 ACK 与模型处理完成分开；不夸大传输成功。

## 5. 架构与组件

```text
Pi A 插件                         Pi B 插件
  模型工具                          模型工具
     ↓                                 ↑
  目标解析 → Unix socket → 校验 / 去重 / 入队
     ↑                                 ↓
  注册表查询                       Pi 自定义消息注入
     ↑                                 ↓
  私有注册目录 ←── 发布身份         B 显式调用回复工具
```

建议模块职责：
- extension：注册工具、命令、消息渲染和 Pi 生命周期事件。
- registry：身份发布、名称解析、文件验证、在线探测。
- transport：socket 监听、认证、JSONL 编解码、超时与资源释放。
- protocol：版本化 schema、消息与回执类型、错误码。
- inbox：入站队列、去重、接收暂停、速率限制。
- conversations：请求/回复关联、限时状态、重复回复保护。
- idle-subscriptions：一次性空闲订阅及过期通知。

使用 TypeScript、Pi Extension API 和 Node.js 内置 IPC/文件 API。通过 Pi package 暴露扩展入口。最低 Pi 版本须在实现计划中依据实际 API 核对，不猜测版本号。

## 6. 身份、发现与本地文件

区分两个 ID：
- sessionId：Pi 会话身份。
- instanceId：每次扩展运行生成的随机 UUID；reload、new、resume、fork 后重新生成。

即使两个进程打开同一个历史会话，也不能仅凭 sessionId 随意挑选；目标必须解析为唯一 instanceId。

建议文件结构：

```text
~/.pi/agent/communication/
  sessions/<instanceId>.json     # 可发现的元数据，无 token
  keys/<instanceId>.json         # 每实例随机 token
```

默认命名空间为当前 Pi agent 配置目录；使用同一 agent 配置目录的实例互相发现。可以由用户级配置指定共享注册根目录；项目资源不能悄悄把注册表指向外部目录。

socket 放在当前用户可信的短 runtime 目录中，使用短随机文件名以遵守 Unix socket 路径长度限制。配置目录与 socket 目录都必须是本机文件系统；不使用 Windows 共享挂载。

目录权限 0700、元数据和密钥 0600、socket 0600。拒绝符号链接、不安全所有者和可被其他用户写入的路径。不删除未知已有端点来抢占地址。

注册元数据包含协议版本、instanceId、sessionId、PID、可获得的进程启动标识、名称、cwd、socket 地址和能力列表。启动顺序是准备私有目录、监听、准备密钥，最后原子发布注册文件。更新使用临时文件 + rename 并串行化。

发现时检查文件大小、schema、权限、进程状态和经过认证的在线探测。PID 只作辅助，最终以对端握手返回的 instanceId/sessionId 为准。过期记录忽略；只清理能够确定属于失效实例且权限合规的记录。

名称默认使用 Pi 会话名，无名称时用工作目录名。展示 name [instance短标识]。支持完整 instanceId、唯一 sessionId、唯一名称以及带短标识名称；歧义必须报错。工具不接受模型提供的任意 socket 路径或 token。

## 7. 对外工具与交互

建议提供四个模型工具：

| 工具 | 职责 |
| --- | --- |
| peer_list | 列出其他在线实例、名称、cwd、忙闲/暂停状态、支持能力 |
| peer_send | 发送 request 或 notification，返回 messageId 与接收结果；可附带一次性空闲订阅，也可只订阅 |
| peer_reply | 用收到的 messageId 回复；自动解析回信目标和 replyTo，不要求模型手写地址 |
| peer_status | 查询当前实例仍保留的请求/投递状态，不阻塞、不轮询等待模型 |

peer_send 的主要参数：to、kind、text、delivery（followUp 或 steer）、可选 notifyWhenIdle。kind 默认为 request；通知不要求业务回复。

peer_reply 的主要参数：messageId、text、outcome（ok 或 error）、delivery。第一版一个请求接受一个终结回复；后续讨论应显式发新请求。发送失败或 ACK 不确定时保持回复状态不确定，不自动重试。

不提供阻塞等待工具。发送完成后模型应继续其他工作或结束当前轮次，来信会触发后续轮次。

用户命令：
- /peers：会话列表及自身通信状态。
- /peers pause：拒绝新的业务入站消息，暂停尚未注入的本地队列。
- /peers resume：重新接收并调度本地队列。

直接使用 Pi /name 改名，不另设相互冲突的命名来源。TUI 显示 Peer · 来源名、请求/回复类型、短消息 ID 和文本。无 UI 时使用结构化工具结果和日志，不依赖弹窗。

## 8. 协议与投递确认

每次操作建立短连接，使用换行分隔 JSON。第一帧是认证与目标握手，服务端成功验证后才接收业务帧。认证不能在日志或工具返回中泄露。

消息 envelope 至少包含：
- version、messageId、kind（request / reply / notification）。
- from 与 to：sessionId、instanceId；显示名只是附加信息。
- text、delivery、createdAt。
- replyTo：仅回复必填，关联原始 request 的 messageId；首版不另设群聊或线程协议。

接收端验证大小、schema、版本、身份、目标运行实例、接收状态、容量、限流及回复关联，再入队并返回 ACK。ACK 表示插件接受到内存，不表示已写入会话历史或模型已处理。

去重键为 from.instanceId + messageId。同一 ID、相同内容返回先前接受结果且不重复入队；同 ID 不同内容拒绝。重复回复不能再次触发模型。

必须区分：
- rejected：明确拒绝，包含 paused、queue_full、rate_limited、stale_target、bad_reply 等原因。
- unavailable：尚未发送时已经确认目标不可用。
- accepted：对端明确确认收件到内存。
- submitted：对端已调用 Pi 消息注入 API；不代表模型已经读到。
- replied：收到了通过 replyTo 校验的业务回复。
- unknown：可能已经送达，但连接/ACK 丢失，无法确定。
- expired：等待回复或本地未注入队列超过期限；不表示对端从未执行。

accepted/submitted 是投递状态，replied/outcome 是业务状态；不能用一个 success 布尔值混淆两层。后续 submitted 或 dropped 通知尽力发送回原实例，不进行无限重试。控制回执只更新状态，通常不触发模型；有意义的失败可以合并为一条来源明确的通知。

## 9. Pi 接收与运行调度

使用 pi.sendMessage 的自定义消息，而不是 pi.sendUserMessage 模拟用户输入。内容明确写出对端身份、消息 ID、replyTo，以及“仅在当前权限内处理，回复须用 peer_reply”。传入 display: true 和结构化 details，供渲染与审计。

默认 followUp：
- 当前空闲且无待处理消息：调度本地队列并以 triggerTurn: true 注入。
- 当前忙碌：保留在插件内存队列；在 agent_settled 的非中止路径检查并调度。
- 注入时仍使用 deliverAs: followUp，处理检查与发送之间的运行状态竞争。
- 这里的“忙完”是 Pi 当前运行结束，不承诺用户的整个长期任务完成。

steer：通过 deliverAs: steer、triggerTurn: true 注入；让 Pi 在当前工具执行完成后的下一个模型调用边界处理，不调用 abort，不强行中断 shell 或工具。

已有队列保持同等级 FIFO。限额同时覆盖插件队列和已经提交给 Pi、尚未观察到进入模型上下文的消息；可在 context 事件中按 details.messageId 观察上下文出现情况释放计数，这不是模型完成确认。已经交给 Pi 的消息不承诺能撤回，也不再宣称可由本地队列 TTL 取消。

agent_end 不是最终空闲边界，不能用它判定工作完成；使用 agent_settled、ctx.isIdle() 和 ctx.hasPendingMessages()。用户 Esc 中止时不在该 settled 回调中自动开启下一轮，暂停插件后续自动调度并告知用户可 /peers resume；已经交给 Pi 的 steer 消息遵从 Pi 本身的中止/队列语义，须在实现验收中验证。

普通 assistant 输出不自动发送给任何会话。收到 request 后提示模型显式回复，但插件不保证模型一定遵循；超时应报告未收到回复，不能伪造业务结果。

## 10. 回复、断线与会话切换

每个实例在内存中保留有限的入站请求、出站请求及状态。peer_reply 只允许回复本实例实际接收到且仍有效的请求；replyTo 验证发送者是原目标实例、接收者是原发起实例。迟到或无法关联的回复不得作为新请求唤醒模型，可以显示为诊断记录。

第一版不自动重连重投业务消息，不启动已退出会话，不将旧 instanceId 的请求静默转给同名新实例。超时只结束本地等待，不取消已在 B 执行的操作。

session_shutdown（包括 reload/new/resume/fork）：先标记 closing、停止接收，撤销注册，停止调度，尽力通知未完成相关方；关闭连接、定时器、socket 并移除本实例拥有的密钥与文件。清理幂等。

session_start 重新获取上下文并发布新 instanceId。不得把旧 ctx/sessionManager、队列、回复映射带入新运行实例。名称变化只更新展示名，不改变身份。

崩溃时队列、去重和关联记录丢失；其他会话通过连接失败、身份不匹配或超时发现异常。已进入 Pi 会话历史的文本可供用户查看，但不据此自动恢复投递或重新执行。

## 11. 空闲订阅

peer_send 可单独或随消息订阅目标实例下一次空闲。以 subscriptionId 关联，一次性消费；目标已经稳定空闲时可立即通知。空闲判定要求 Pi idle、无 Pi 待处理消息、无插件待注入消息；设置约 750ms 去抖并在发送前复查。

通知包括 idle、exited、expired、unavailable。正常退出尽力通知，崩溃只能超时。已暂停的接收方不通过 idle 通知误导发送方认为排队消息已处理。

空闲不等于请求成功，也不代替 replyTo 业务回复。通知标记为自动状态，默认不要求再次回复。

## 12. 安全、限额与循环防护

本插件的信任边界是同一 OS 用户及私有配置目录，不是同用户恶意进程之间的强隔离。同用户进程可以读取密钥；token、目录权限和握手不能宣称阻挡这一类攻击。握手校验只在该信任假设下提供身份一致性。

来信不能直接调用工具、执行命令、修改权限或展开 slash commands。模型仍可能根据来信调用当前已有工具；安全性仍依赖接收会话的权限控制。不能只靠提示词保证消除提示注入。

首版建议限额：单帧 1 MiB、连接超时 5 秒、并发连接 32、未注入业务消息 100、去重 1000 条/10 分钟、请求与回复关联记录 1000 条/30 分钟、空闲订阅 32 条/12 小时。超额明确拒绝，不悄悄驱逐仍在等待的活跃请求。请求过期后可丢弃对应关联记录。

尚未注入的消息最多保留 10 分钟，过期通知原发送方；已经注入的消息不受此 TTL 撤销。消息进入模型上下文仍不保证已执行。

每个发送实例建议限流 30 条业务消息/分钟。request 默认提示只返回一次终结回复；notification 不要求回复；控制 ACK 不触发自动应答。peer_reply 不能回复 reply，只能回复有效 request，避免机制层面的回复套回复。模型仍可能主动新建 request 继续聊天，所以还需要限流、接收暂停和用户 Esc；这些保护不等于严格的总 token 预算，也不声称能完全阻止模型无意义聊天。

## 13. 验证与验收要求

单元测试覆盖：schema、名称歧义、目标实例、权限和链接检查、JSON 分帧及 UTF-8 分片、大小限制、超时、去重、ACK 不确定、replyTo 伪造/迟到、容量/速率/过期、订阅消费、生命周期清理。

真实 IPC 集成测试使用独立进程和临时私有目录，不仅用模拟 socket。覆盖并发启动、注册原子性、重名、PID/地址残留、重启换身份、断在发送前/接收后/ACK 前的不同窗口；验证没有自动重复执行。

Pi 适配测试覆盖空闲自动触发、followUp 等待、steer 不打断工具、context 计数、agent_settled 与 agent_end 区别、Esc 后不自动续跑、pause/resume、reload/new/resume/fork 清理。

最后以两个真实 Pi 会话验收：发现 → 请求 → 显式回复 → A 收到关联结果；再验证 B 忙碌、B 退出、重名、会话切换与用户暂停。优先使用可控假模型验证流程，再在授权且有凭据时运行最小真实模型冒烟。必须区分测试通过与仅静态检查，不把假模型结果称为真实模型验证。

## 14. 留给实现计划的决定

批准设计后，再依据 Pi 文档与 SDK 核对最低版本、扩展打包方式、测试运行器和各模块接口。需要验证 context 事件可观测的消息格式以及中止后的队列行为；如果实际 API 不支持设计中的边界，应先修订设计，不私自改变语义。

以上数值、Linux/macOS 首发范围、内存可靠性及工具命名均为本草案建议。批准前不搭建产品代码、安装依赖或开始实现。
