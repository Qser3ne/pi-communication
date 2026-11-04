# Pi Peer Communication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 两个已打开的独立 Pi 会话能自主发现、发送请求并显式回复，具有明确的忙时调度、投递状态和身份边界。

**Architecture:** 每个扩展运行实例监听私有 Unix socket，使用文件注册表发现对端，通过经过认证的 JSONL 短连接直接通信。消息与关联状态只保存在内存；Pi 适配层用自定义消息触发运行，不模拟用户键盘输入。没有中央服务、离线恢复或自动业务重试。

**Tech Stack:** TypeScript、Node.js >=22.19.0、Pi Extension API；内置 net/fs/crypto；TypeBox schema；Vitest。本地已核对宿主 @earendil-works/pi-coding-agent 1.5.0，首版声明最低支持 1.5.0，实际验收版本必须记录。

**Spec:** docs/superpowers/specs/2026-11-04-peer-communication-design.md（已批准）。

## Global Constraints

- 仅同机、同一 OS 用户、启用扩展的在线会话；Linux/macOS；无 Windows、网络通信或子会话启动。
- Socket 直连 + 文件注册表；消息、去重、请求关联不跨重启恢复，不自动重投业务操作。
- 默认 followUp，发送方可选 steer；不强行中断工具。用户 Esc 后暂停后续自动调度。
- 四个工具：peer_list、peer_send、peer_reply、peer_status；用户命令 /peers、/peers pause、/peers resume；命名复用 /name。
- sessionId + 随每次运行变化的 instanceId；禁止重名猜测、任意 socket 路径和旧实例自动迁移。
- 目录 0700、文件与 socket 0600；强制认证；不把同用户进程视为安全隔离边界。
- 单帧 1 MiB；连接超时 5 秒；并发连接 32；未注入/待上下文观察消息 100。
- 去重 1000 条/10 分钟；请求与回复关联记录 1000 条/30 分钟；空闲订阅 32 条/12 小时。
- 尚未注入的消息 10 分钟过期；已经提交 Pi 的消息不能承诺撤销。
- 每个发送实例 30 条业务消息/分钟；一次性空闲通知去抖 750ms；request 只接受一个终结 reply。
- Host-provided packages 只列在 peerDependencies（范围 *）及开发依赖，不进 runtime dependencies、不打包宿主。运行时版本检查与 README 表明最低 Pi 1.5.0。
- 使用 pnpm 和锁文件；产品运行时无额外第三方依赖。开发依赖包含 TypeScript、Vitest、tsx、@types/node 及宿主类型依赖。
- 不复制参考仓库源码，依据其行为独立实现；保留参考链接，产品许可证不擅自替用户决定。

## Review Focus

- 名称及正文含 ANSI/OSC、换行、XML 风格闭合标签：终端不能被控制，正文不能伪造来源；Task 1、8 增加断言。
- 对端 accepted 后 ACK 丢失，或回执晚于回复：只报告 unknown、不重发，状态不可回退；Task 3、5、9。
- 同一个 sessionId 同时在两个进程打开，或 /reload 后仍收到旧消息：必须歧义拒绝/旧实例拒绝；Task 2、6、9。
- compaction、context 重建、其他扩展过滤以及用户 Esc 发生在注入附近：不能重复注入、误报完成或立即自动续跑；Task 6、9。
- 启动失败只完成了一半，以及用户退出时仍有连接/订阅：不得删除别人的文件或留下活跃句柄；Task 2、3、7、9。

## 执行前提与文档依据

当前项目目录只有 .pi 资源和设计文档，不是 Git 仓库。执行开始时先按 using-git-worktrees 检查隔离方式；经用户授权执行后可初始化 Git、设置忽略规则并提交批准文档，再创建工作分支/隔离目录。不要把 .pi/git 中的第三方仓库或本机配置加入版本控制。未授权执行前不初始化、不安装依赖。

实施 Pi 集成之前完整阅读安装宿主的 docs/extensions.md、docs/packages.md、docs/rpc.md、docs/rpc-commands.md、docs/models.md，以及相关交叉引用和 examples/extensions/message-renderer.ts、file-trigger.ts。本文不是这些 API 文档的替代品。

已核实的接口：session_start / session_shutdown / session_info_changed、agent_settled.aborted、ctx.isIdle()、ctx.hasPendingMessages()、context.messages、getAgentDir()、pi.sendMessage(..., { deliverAs, triggerTurn })。

重要细节：context 中的消息可为 role: custom 并携带 details，但 Pi 最终会把自定义消息转换为模型 user-role 文本。因此来源说明必须存在于正文，不能只靠隐藏 details 或声称获得了独立的模型权限等级。

## 文件结构

```text
package.json / pnpm-lock.yaml / tsconfig.json / vitest.config.ts / .gitignore
README.md
src/
  index.ts                         # 扩展入口与事件注册
  protocol.ts                      # schema、公共类型、编解码与来源文本
  limits.ts                        # 固定数值和 Clock 抽象
  registry.ts                      # 私有目录、原子发布、发现与消歧
  transport.ts                     # 认证 JSONL socket 与超时/ACK
  inbox.ts                         # 有界队列、去重、限流、过期
  conversations.ts                 # 请求/回复与投递状态
  idle.ts                          # 一次性空闲订阅
  runtime.ts                       # 运行实例组合和 lifecycle
  pi-adapter.ts                    # Pi 调度与上下文观察
  tools.ts                         # 四个模型工具及 schema
  ui.ts                            # /peers 与来源渲染
 tests/
  unit/*.test.ts
  integration/*.test.ts
  e2e/pi-peers.test.ts
  fixtures/peer-process.ts
  fixtures/fake-model-server.ts
  helpers/pi-host.ts
  helpers/fixtures.ts
 docs/acceptance.md
```

各任务的 test 文件是上述目录中的精确路径，不再另造重叠模块。仅在实现后确有独立职责时拆分文件，不预设巨型 manager。

## 公共接口约定

以下类型在 Task 1 的 protocol.ts 定义，Clock 和 LIMITS 在 limits.ts。后续任务直接 import，不另起同义字段。

```ts
type Delivery = 'followUp' | 'steer';
type PeerIdentity = { sessionId: string; instanceId: string; name: string };
type PeerRecord = PeerIdentity & {
  version: 1; pid: number; processStart?: string; cwd: string;
  endpoint: string; features: string[];
};
type PeerView = PeerRecord & { activity: 'busy' | 'idle'; paused: boolean };
type MessageEnvelope = {
  version: 1; messageId: string; kind: 'request' | 'reply' | 'notification';
  from: PeerIdentity; to: PeerIdentity; text: string; delivery: Delivery;
  createdAt: number; replyTo?: string; outcome?: 'ok' | 'error';
};
type ReceiptEnvelope = {
  version: 1; kind: 'receipt'; messageId: string;
  from: PeerIdentity; to: PeerIdentity; originalMessageId: string;
  state: 'submitted' | 'dropped' | 'expired';
};
type IdleEnvelope = {
  version: 1; kind: 'idle-subscribe' | 'idle-notice'; messageId: string;
  from: PeerIdentity; to: PeerIdentity; subscriptionId: string;
  state?: 'idle' | 'exited' | 'expired' | 'unavailable';
};
type Envelope = MessageEnvelope | ReceiptEnvelope | IdleEnvelope;
type Ack = { messageId: string; status: 'accepted' | 'rejected'; code?: string };
type Transmission = Ack | { messageId: string; status: 'unknown' | 'unavailable'; code: string };
type RequestStatus = {
  messageId: string;
  delivery: 'sending' | 'accepted' | 'submitted' | 'rejected' | 'unknown' | 'unavailable' | 'expired' | 'dropped';
  response: 'not_expected' | 'pending' | 'replied' | 'expired';
  replyMessageId?: string; outcome?: 'ok' | 'error';
};
interface Clock { now(): number }
```

所有 ID 使用 UUID；解析 schema 要按 kind 约束字段（例如 reply 必须带 replyTo/outcome，其他业务类型不得带）。kind 区分运行时可用 discriminated union，不能靠 unchecked cast 放过无效帧。错误 code 使用稳定 snake_case，例如 stale_target、bad_reply、queue_full、rate_limited、paused、unsupported_version、id_conflict、capacity、timeout。

---

### Task 1: 建立协议与可执行测试基础

**Files:** Create package.json、tsconfig.json、vitest.config.ts、.gitignore、src/protocol.ts、src/limits.ts；Test tests/unit/protocol.test.ts。

**Interfaces:** Produces 公共类型、LIMITS、parseEnvelope(value: unknown): Envelope、encodeFrame(value: unknown): Buffer、formatPeerContent(message: MessageEnvelope): string。非法参数抛有 code 的 ProtocolError。

- [ ] 配置 type: module、pi.extensions: ['./src/index.ts']、keywords: ['pi-package']；scripts 为 test: vitest run、test:unit / test:integration / test:e2e 按目录执行、typecheck: tsc --noEmit。排除 fixtures 成为自动加载扩展，依赖安装写锁文件；此时先不创建产品入口的行为。
- [ ] 在 tests/unit/protocol.test.ts 写失败测试，最小固定案例：
  ```ts
  expect(() => parseEnvelope({ version: 2 })).toThrow();
  expect(() => parseEnvelope({ ...validRequest, kind: 'reply' })).toThrow();
  expect(encodeFrame(validRequest).at(-1)).toBe(10);
  expect(() => encodeFrame({ text: 'x'.repeat(1024 * 1024) })).toThrow();
  expect(formatPeerContent(validRequest)).toContain(validRequest.messageId);
  expect(formatPeerContent(validRequest)).toContain('peer_reply');
  ```
  另固定恶意显示名含 OSC/ANSI、正文含伪造来源闭合标签的样本：显示名清理后不能含控制序列；正文采用清晰 JSON 字符串或可靠转义边界，不能产生第二段可信元数据。
- [ ] 运行 `pnpm exec vitest run tests/unit/protocol.test.ts`，确认因尚未实现协议而失败，而非测试命令或配置错误。
- [ ] 实现 schema、字节大小校验、来源 framing 和精确限额；不要为 XML 包装另写宽松正则解析器。消息正文固定包含非用户授权说明、权限不能升级以及 request 的显式回复要求。
- [ ] 重跑该测试和 `pnpm typecheck`，要求全部通过；生成的 fixture 不得使用真实 token。
- [ ] 提交该任务文件及锁文件：`git commit -m "feat: define peer message protocol and limits"`。

### Task 2: 实现私有注册表和唯一目标解析

**Files:** Create src/registry.ts、tests/helpers/fixtures.ts；Test tests/unit/registry.test.ts。

**Interfaces:** Consumes PeerRecord/PeerView、Clock。Produces resolvePaths(agentDir: string, configRoot?: string): RegistryPaths；createRegistry(paths: RegistryPaths): Registry；Registry.publish(record: PeerRecord, token: string): Promise<void>、updateName(instanceId: string, name: string): Promise<void>、discover(probe: (record: PeerRecord) => Promise<PeerView>): Promise<PeerView[]>、resolve(to: string, peers: PeerView[]): PeerView、readToken(instanceId: string): Promise<string>、removeOwn(instanceId: string): Promise<void>。RegistryPaths 明确为 {root, sessionsDir, keysDir, socketDir}。

- [ ] 写临时目录测试：正常文件权限、name [ref]、唯一 UUID；同名和同 sessionId 两实例报 ambiguous_target；符号链接、其他用户可写目录、过大/残缺 JSON、失效 PID、探测失败记录不可发现；并发改名不能丢字段。断言 `mode & 0o777` 对目录为 0o700、文件为 0o600。
  核心断言：
  ```ts
  expect(() => registry.resolve('reviewer', [peerA, peerB])).toThrow('ambiguous_target');
  expect(() => registry.resolve(peerA.sessionId, [sameSessionA, sameSessionB])).toThrow('ambiguous_target');
  expect((await stat(recordPath)).mode & 0o777).toBe(0o600);
  expect((await registry.discover(probe)).some(p => p.instanceId === deadPeer.instanceId)).toBe(false);
  ```
- [ ] 运行 `pnpm exec vitest run tests/unit/registry.test.ts`，确认未实现接口导致红灯。
- [ ] 实现目录检查、可信 runtime 路径、短随机 socket 文件名、64 KiB 注册文件上限；探测并发上限 8、单次 300ms。Registry.resolve 不接收 uds: 或任意路径，短标识扩展到唯一再展示。
- [ ] 写并修复启动失败回滚测试：预先存在的他人文件内容不变；只能删除本次创建且身份仍匹配的文件。私有配置使用 `<getAgentDir()>/communication/config.json` 的 registryRoot（绝对本机路径）；不读取 cwd 项目设置。
- [ ] 重跑该测试和 `pnpm typecheck`；要求发布与读取不会暴露半份 JSON，日志不含 token。
- [ ] 提交：`git commit -m "feat: add secure local peer registry"`。

### Task 3: 实现真实 Socket 认证、分帧与 ACK

**Files:** Create src/transport.ts、tests/fixtures/peer-process.ts；Test tests/integration/transport.test.ts。

**Interfaces:** Consumes Registry、Envelope、Ack、Transmission。Produces listenPeer(options: {record: PeerRecord; token: string; onFrame: (frame: Envelope) => Promise<Ack>; getView: () => PeerView}): Promise<PeerServer>；PeerServer.close(): Promise<void>；probePeer(record: PeerRecord, token: string, timeoutMs?: number): Promise<PeerView>；sendFrame(record: PeerRecord, token: string, frame: Envelope, signal?: AbortSignal): Promise<Transmission>。

- [ ] 写真实 net/socket 测试：认证缺失/错误拒绝、目标 instanceId 错误拒绝、同一连接多个帧规则、UTF-8 字符跨 chunk、超长无换行缓冲、EOF 半帧、32 连接上限、取消、close 幂等。认证握手校验双方 ID 和版本，探测只返回状态、不入模型队列。
- [ ] 运行 `pnpm exec vitest run tests/integration/transport.test.ts`，确认红灯。
- [ ] 实现 byte-counted JSONL + StringDecoder；整个连接 deadline 为 5000ms，不因攻击者慢速发字节而无限延长。握手成功后每连接只处理一次操作及其 ACK；收到超额业务帧拒绝，不能默默多执行。
- [ ] 加入“B 已接受但关闭连接不发 ACK”的故障测试：发送方结果必须为 unknown，接收处理计数必须为 1；成功写入不能提前 resolve accepted。业务字节尚未可能发送前失败可报 unavailable；边界无法确定时保守 unknown。
  关键故障断言：
  ```ts
  expect(result.status).toBe('unknown');
  expect(receivedMessages).toHaveLength(1);
  expect(logText).not.toContain(token);
  ```
- [ ] 重跑集成测试与 `pnpm typecheck`。验证 token 不进入日志、运行结束无打开 socket/定时器；预先存在端点不被 unlink。
- [ ] 提交：`git commit -m "feat: add authenticated socket transport and acknowledgements"`。

### Task 4: 实现有界收件队列、去重、暂停与限流

**Files:** Create src/inbox.ts；Test tests/unit/inbox.test.ts。

**Interfaces:** Consumes MessageEnvelope、Clock、LIMITS。Produces createInbox(clock: Clock): Inbox；Inbox.lookupDuplicate(message: MessageEnvelope): Ack | undefined、admit(message: MessageEnvelope): Ack、take(delivery: Delivery): MessageEnvelope | undefined、markSubmitted(messageId: string): void、observeContext(ids: string[]): void、setPaused(paused: boolean): void、expire(): MessageEnvelope[]、drain(): MessageEnvelope[]、hasPending(): boolean。

- [ ] 写可控时钟测试：重复 ID 相同内容只接受一次；同 ID 不同内容 id_conflict；第 101 个未观察消息 queue_full；同发送方第 31 条/分钟 rate_limited；暂停拒绝新业务但保留已有队列；take 保留 FIFO；take/markSubmitted 不立即释放容量，observeContext 才释放；expire 不撤销 submitted 消息。
  使用不同发送方隔离容量和单发送方限流测试：
  ```ts
  expect(inbox.admit(first).status).toBe('accepted');
  expect(inbox.lookupDuplicate(first)?.status).toBe('accepted');
  expect(inbox.admit({ ...first, text: 'changed' }).code).toBe('id_conflict');
  expect(fullInbox.admit(nextMessage).code).toBe('queue_full');
  expect(rateLimitedInbox.admit(message31).code).toBe('rate_limited');
  ```
- [ ] 运行 `pnpm exec vitest run tests/unit/inbox.test.ts`，确认红灯。
- [ ] 实现原子 admission：先验证容量/限流，再一起写入去重和队列。重复已接受消息不重复消耗限流。去重最多 1000 条/600000ms，活跃记录容量不足报 capacity，不驱逐仍需保护的消息。将已出队但未提交的短暂状态保留在内部，以便注入失败可确定回收。
- [ ] 加入 exact boundary 测试：600000ms 的待注入消息过期、已提交消息不被过期；观察重复 context 不得重复释放计数；distinct sender 各自独立限流。修正实现至通过。
- [ ] 运行该测试及 `pnpm typecheck`，确认通过。
- [ ] 提交：`git commit -m "feat: bound peer inbox admission and deduplication"`。

### Task 5: 实现请求、显式回复和单调状态

**Files:** Create src/conversations.ts；Test tests/unit/conversations.test.ts。

**Interfaces:** Consumes MessageEnvelope、ReceiptEnvelope、Transmission、Clock。Produces createConversations(self: PeerIdentity, clock: Clock): Conversations；recordOutgoing(message: MessageEnvelope): void、recordIncoming(message: MessageEnvelope): void、validateIncoming(message: MessageEnvelope): void、recordTransmission(id: string, result: Transmission): void、applyReceipt(receipt: ReceiptEnvelope): void、makeReply(id: string, text: string, outcome: 'ok' | 'error', delivery: Delivery): MessageEnvelope、getStatus(id?: string): RequestStatus[]、expire(): RequestStatus[]、clear(): void。validateIncoming 只验证不修改；入队成功后才 recordIncoming。

- [ ] 写失败测试：出站请求必须在 send 前登记，避免快回复先到；replyTo 正确且来源匹配变 replied；未请求、错误来源、已过期请求拒绝 bad_reply；reply 不能作为 makeReply 的目标；重复 reply 不重复消费；普通 assistant 文本不改变状态。
  关键断言：
  ```ts
  expect(() => conversations.validateIncoming(forgedReply)).toThrow('bad_reply');
  expect(() => conversations.makeReply(receivedReply.messageId, 'again', 'ok', 'followUp')).toThrow('bad_reply');
  expect(conversations.getStatus(request.messageId)[0]?.response).toBe('replied');
  ```
- [ ] 运行 `pnpm exec vitest run tests/unit/conversations.test.ts`，确认红灯。
- [ ] 实现 1000 条/1800000ms 的有界关联表及两个状态维度。回复早于 accepted/submitted 回执时，后来的回执不能把 response 从 replied 回退。超时只标等待过期，不声称远端取消。
- [ ] 加入 ACK 不明、回复发送未知、迟到回执、容量占满测试；makeReply 在发送前保留一次回复尝试状态，失败不自动发第二条。协议相同 ID 的传输重复由 inbox 去重，但不做透明重试。
- [ ] 重跑该测试及 `pnpm typecheck`，确认通过。
- [ ] 提交：`git commit -m "feat: correlate peer replies and delivery states"`。

### Task 6: 实现运行实例生命周期与 Pi 调度适配

**Files:** Create src/runtime.ts、src/pi-adapter.ts、src/index.ts、tests/helpers/pi-host.ts；Test tests/unit/runtime.test.ts、tests/unit/pi-adapter.test.ts。

**Interfaces:** Consumes Registry/transport/Inbox/Conversations。Produces createRuntime(options: {identity: PeerIdentity; cwd: string; agentDir: string; clock: Clock; host: PeerHost}): PeerRuntime；PeerRuntime.start(): Promise<void>、close(): Promise<void>、list(): Promise<PeerView[]>、send(input: SendInput, signal?: AbortSignal): Promise<SendResult>、reply(input: ReplyInput, signal?: AbortSignal): Promise<Transmission>、status(id?: string): RequestStatus[]、pause(): void、resume(): void、rename(name: string): Promise<void>、onSettled(aborted: boolean): void、observeContext(ids: string[]): void。SendInput/ReplyInput 在 runtime.ts 导出并对应设计工具参数；SendResult 为 {message?: Transmission; subscription?: {id: string; status: string}}，订阅由 Task 7 补全。

PeerHost 接口在 pi-adapter.ts：isIdle(): boolean、hasPendingMessages(): boolean、inject(message: MessageEnvelope): void、notice(text: string, modelVisible: boolean): void。createPiHost(pi: ExtensionAPI, ctx: ExtensionContext): PeerHost；inject 以自定义消息和原 delivery 调用 pi.sendMessage。

- [ ] 写适配器失败测试：空闲触发 custom message；忙时 followUp 不注入直到非 aborted settled；steer 直接交给 Pi 且不调用 abort；agent_end 不 drain；Esc 暂停下一轮并拒绝新入站，resume 后才继续；details.messageId 可被 context 观察。
  PeerHost 使用有类型 fake，不断言未经文档支持的 Pi 内部字段：
  ```ts
  expect(host.inject).not.toHaveBeenCalled(); // busy + followUp
  runtime.onSettled(true);
  expect(host.inject).not.toHaveBeenCalled(); // Esc must not restart
  runtime.resume();
  expect(host.inject).toHaveBeenCalledTimes(1); // now idle, one queued message
  ```
- [ ] 运行 `pnpm exec vitest run tests/unit/runtime.test.ts tests/unit/pi-adapter.test.ts`，确认红灯。
- [ ] 实现串行运行实例状态机 starting/active/closing/closed；工厂阶段只注册，不启动 socket。session_start 创建 instanceId；session_shutdown 立即阻止新调度，依次注销、有限期回执、关闭资源；所有异步回调验证 generation，不复用旧 ctx。仅注册成功后允许工具发送。
- [ ] 组合入站验证顺序：协议、来源和目标 → inbox.lookupDuplicate（相同帧立即返回原 ACK，不重新消费 reply）→ conversations.validateIncoming → inbox.admit → recordIncoming → 返回 ACK 并安排调度。lookupDuplicate 对同 ID 不同内容返回 id_conflict；验证和提交之间不得 await，以保证并发 admission 原子性。回复/通知同样受上限，控制帧独立有界处理，控制队列最大 200。发送方收到 ACK 前不会声称 accepted；接收端调度与网络 ACK 到达不承诺先后，晚到回执不得回退状态。
- [ ] 写切换、reload、启动半失败、同 sessionId 多实例测试；验证旧任务 callback 不注入新会话、清理两次无错误、停止期间不能接收。模拟重复 context、上下文过滤后不出现 ID：保持容量占用而不是虚假释放；关停才清理。
- [ ] 重跑测试及 `pnpm typecheck`。入口在不支持的平台/Pi 版本上给明确错误，不发布端点；支持版本不将 token 或正文写调试日志。
- [ ] 提交：`git commit -m "feat: integrate peer lifecycle with Pi message scheduling"`。

### Task 7: 增加一次性空闲订阅

**Files:** Create src/idle.ts；Modify src/runtime.ts、src/pi-adapter.ts；Test tests/unit/idle.test.ts、tests/integration/idle.test.ts。

**Interfaces:** Produces createIdleSubscriptions(self: PeerIdentity, clock: Clock): IdleSubscriptions；subscribe(target: PeerIdentity): IdleEnvelope、accept(frame: IdleEnvelope): void、takeNotices(state: 'idle' | 'exited', eligible: boolean): IdleEnvelope[]、receive(frame: IdleEnvelope): boolean、expire(): IdleEnvelope[]、clear(): void。runtime 负责时钟与发送，idle 模块不私自创建后台资源。

- [ ] 写失败测试：只订阅不发 text；随发送订阅；同目标替换旧订阅、最多 32 个、12 小时过期；notice 必须匹配实例和 subscriptionId 且只消费一次；暂停、待处理队列或已提交未观察消息不算空闲。
  核心断言：
  ```ts
  expect(idle.receive(validNotice)).toBe(true);
  expect(idle.receive(validNotice)).toBe(false);
  expect(idle.receive(wrongInstanceNotice)).toBe(false);
  expect(idle.takeNotices('idle', false)).toEqual([]);
  ```
- [ ] 运行 `pnpm exec vitest run tests/unit/idle.test.ts tests/integration/idle.test.ts`，确认红灯。
- [ ] 在 runtime 实现 750ms 去抖，到时复查 idle 和队列；正常退出尽力发送 exited，关闭总等待不超过 1000ms；远端崩溃由订阅方本地 expire 发通知。不因一次 notice 自动创建新订阅。
- [ ] 加入“去抖期间新请求到达”“订阅满后不发虚假成功”“notice 丢失不循环重试”测试并实现。modelVisible 的通知通过 Pi followUp 注入且标明是状态、不是指令；paused 时仅用户可见，避免重新唤醒。
- [ ] 重跑两组测试及 `pnpm typecheck`，确认定时器可释放。
- [ ] 提交：`git commit -m "feat: notify peers once when sessions become idle"`。

### Task 8: 接入模型工具与用户控制界面

**Files:** Create src/tools.ts、src/ui.ts、README.md；Modify src/index.ts；Test tests/unit/tools.test.ts、tests/unit/ui.test.ts。

**Interfaces:** Consumes PeerRuntime。Produces registerPeerTools(pi: ExtensionAPI, getRuntime: () => PeerRuntime | undefined): void、registerPeerUi(pi: ExtensionAPI, getRuntime: () => PeerRuntime | undefined): void；renderPeerText(message: MessageEnvelope, expanded: boolean): string。工具必须使用 signal，UI 在 ctx.hasUI 为 false 时不调用交互弹窗。

- [ ] 写失败测试：四工具名称、schemas 与默认值；send text 为空且未订阅时拒绝；request/reply/notification 对应结果字段；拒绝任意路径寻址；无 runtime 时 unavailable；不得泄露 token；reply 明确不接受 reply 类型的 messageId。
  核心断言：
  ```ts
  expect(registeredToolNames.sort()).toEqual(['peer_list', 'peer_reply', 'peer_send', 'peer_status']);
  expect(renderPeerText(ansiMessage, true)).not.toContain('\u001b');
  expect(serializedToolResult).not.toContain(token);
  ```
- [ ] 运行 `pnpm exec vitest run tests/unit/tools.test.ts tests/unit/ui.test.ts`，确认红灯。
- [ ] 实现工具的最小说明，包含“异步，无需循环轮询”“普通回答不会回传”“只在现有权限内操作”。状态结果保留 delivery/response 两个维度，并对 unknown 说明可能已执行，禁止提示自动重试。
- [ ] 实现 /peers 列表/暂停/恢复与 custom renderer；来源名、消息类型和短 ID 清晰显示，长文本折叠；渲染清除 ANSI/OSC/C0 控制字符但保留正文换行。新增含终端逃逸序列的渲染断言，不直接打印原始对端控制字符。
- [ ] 写 README：本地安装与显式 -e 测试、/name 命名、两窗口示例、私有目录、版本/平台限制、无离线恢复、未知结果、pause/resume、非权限隔离声明。清楚说明自定义消息最终仍是模型 user-role 文本，不冒充更高权限。
- [ ] 重跑两组测试及 `pnpm typecheck`，确认 headless 与 TUI 两条路径；不修改用户全局 settings。
- [ ] 提交：`git commit -m "feat: expose peer tools and session controls"`。

### Task 9: 双进程 Pi 验收与发布前检查

**Files:** Create tests/fixtures/fake-model-server.ts、tests/e2e/pi-peers.test.ts、docs/acceptance.md；Extend tests/fixtures/peer-process.ts；Modify package.json（验收 scripts）、README.md（验证记录/限制）。

**Interfaces:** Uses 真实 Pi CLI 的 RPC JSONL 和协议工具，不另起产品 API。Fake server 提供仅 loopback 的 OpenAI-compatible completions/SSE，按测试脚本发工具调用与最终文本，不使用外部 API key。通过临时 models.json 配置模型；Pi 主进程使用同一个临时 agentDir、两个独立 cwd、明确 -e 指向本扩展，隔离其他个人扩展和技能。

- [ ] 在阅读完整 RPC/models 文档后编写失败 E2E：A 的假模型调用 peer_list 和 peer_send，B 无用户额外输入即收到请求、调用 peer_reply，A 收到唯一关联回复。订阅事件先于 prompt，等待 agent_settled 不是只看 prompt ACK；设 60000ms 测试上限并保存脱敏事件流。
  从两个进程的事件/工具结果提取 messageId 后，至少断言：
  ```ts
  expect(reply.replyTo).toBe(request.messageId);
  expect(reply.from.instanceId).toBe(peerB.instanceId);
  expect(receivedReplyEvents).toHaveLength(1);
  expect(sideEffectCounter).toBe(1); // ACK loss must not repeat work
  ```
- [ ] 运行 `pnpm test:e2e`，记录尚未实现的 fixture/集成失败；测试不得访问真实模型服务或用户会话目录。
- [ ] 实现 fake server 与 subprocess 清理；再增加：B 可控慢工具运行时 followUp 等待而 steer 不杀工具、同名消歧、同 sessionId 两实例、B 退出/重启、RPC 新会话/切换、用户中止后不自动继续、pause/resume、超时或失去 ACK 不重试。/reload 与 /fork 如 RPC 不覆盖，列为真实 TUI 人工验收，不假称已覆盖。
- [ ] 实现失败窗口注入：对端收件后 ACK 前关闭、回执乱序、关停中连接。所有测试断言接收计数/工具副作用计数，不能只比较成功提示文本。
- [ ] 运行 `pnpm test:unit && pnpm test:integration && pnpm test:e2e && pnpm typecheck && git diff --check`，要求全部 exit 0。任何失败留在当前任务，不带着红灯宣布完成。
- [ ] 以两个真实交互 Pi 终端验收 /peers、/name、来源渲染、/reload、/new、/resume、/fork、Esc、退出清理。记录 Linux 的实际结果；无 macOS 环境时明确“目标支持、尚未运行验证”，不杜撰跨平台通过。
- [ ] 执行 `pnpm pack --pack-destination /tmp/pi-communication-pack` 并检查 tar 内容：只含必要 src、README、manifest；不含 .pi、token、测试运行输出或本地注册表。用临时 agentDir 安装/加载包确认发现入口，不全局安装。
- [ ] 更新 docs/acceptance.md：每个验收项的命令、结果、环境和未验证项；真实模型调用只有在另行获准且有凭据时进行，没有做就明确写未做。
- [ ] 提交：`git commit -m "test: verify cross-session communication in real Pi processes"`。

## 自检与验收映射

- Spec 1–4：Task 1 的边界、协议与 README；架构不再出现中央服务。
- Spec 5–6：Task 2、3、6 的身份、注册、传输、清理。
- Spec 7–8：Task 1、3、5、8 的工具与投递状态。
- Spec 9–10：Task 4–6、9 的队列、上下文、回复、断线和切换。
- Spec 11：Task 7 的空闲订阅。
- Spec 12：Task 1–5、8 的限额/权限/渲染保护，Task 9 故障窗口验收。
- Spec 13：Task 9 的真实 IPC、真实 Pi、假模型与人工 TUI 分层验证。
- Spec 14：执行前完整读 API 文档；若 Pi 中止行为不支持既定保证，停止并修订设计，不用静默降级掩盖。

## 执行交接

本计划只描述未来执行步骤，当前未创建产品代码、未安装依赖、未运行产品测试。用户需先审阅计划并选择执行方式：本会话逐步执行，或明确授权子代理实现/独立审查。由于 protocol → registry/transport → runtime → tools 的接口依赖紧密，默认推荐本会话顺序执行；独立审查只在获得授权后安排。
