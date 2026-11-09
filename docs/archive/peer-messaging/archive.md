# peer-messaging

## Purpose

定义 peer 工具的请求、通知、显式回复、异步投递结果和短期关联状态。

## Requirements

### Requirement: 公共工具与分页

扩展 SHALL 提供 peer_list、peer_send、peer_reply、peer_status 四个工具；peer_list 与 peer_status SHALL 使用 offset/limit 分页，默认 20 条、上限 100 条，并将选中行的 JSON 字节预算限制为 40000。

#### Scenario: 分页结果尚有剩余

- **WHEN** 本页未包含全部结果
- **THEN** SHALL 返回 total 和 nextOffset，不截断为无效 JSON
- **AND** 运行时尚未可用时 SHALL 返回 unavailable 错误

### Requirement: 异步请求和通知

peer_send SHALL 默认使用 kind=request 和 delivery=followUp；notification MUST 不建立回复义务。正文 MUST 非空白，除非同时设置 notifyWhenIdle=true。

#### Scenario: 发送请求

- **WHEN** 向可发现的目标发送正文
- **THEN** SHALL 返回本次 messageId 和投递状态，不阻塞等待业务回复
- **AND** SHALL 不自动重发正文或转发普通 assistant 输出
- **AND** 目标解析遵守[发现规则](../peer-discovery/archive.md)，调度遵守[投递控制](../peer-delivery-control/archive.md)

### Requirement: 显式且一次性的回复

peer_reply MUST 只针对当前实例收到且仍有效的 request，默认 outcome=ok、delivery=followUp；MUST 不回复 notification、reply、未知请求或其他实例收到的请求。

#### Scenario: 收件人显式回复

- **WHEN** 调用 peer_reply 并提供原请求 messageId 和非空正文
- **THEN** SHALL 将回复关联到原发送实例，携带 replyTo 和 ok/error outcome
- **AND** 同一请求 SHALL 只允许预留一次回复尝试；即使该尝试失败，也不自动开放第二次尝试
- **AND** 来自非原目标实例或无有效关联的回复 MUST 拒绝

### Requirement: 投递和业务响应分别记录

状态 MUST 分别记录 delivery 与 response；accepted SHALL 仅表示对端内存队列收件，submitted SHALL 仅表示已调用 Pi 注入接口，replied SHALL 表示已收到显式业务回复。

#### Scenario: 未收到 ACK

- **WHEN** 正文可能已经发出但未确认匹配的 ACK
- **THEN** SHALL 返回 unknown，而不是断言未执行
- **AND** 超时、expired、dropped 或不可用 SHALL 不作为远端业务未发生的证明
- **AND** 工具 SHALL 明示不得循环轮询或自动重试 unknown 投递

#### Scenario: 回执或回复先于发送结果

- **WHEN** submitted 回执或业务回复早于发送 ACK 到达
- **THEN** SHALL 不因迟到 ACK 将已推进状态退回 accepted
- **AND** 已终止的投递状态 MUST 不被迟到 submitted 回执重新激活

### Requirement: 有界关联与重启边界

请求关联 SHALL 最多保留 1000 条、有效期 30 分钟；peer_status SHALL 只查询当前实例保留的记录，支持按 messageId 查询或分页列举。

#### Scenario: 关联到期或实例重启

- **WHEN** 请求关联已到期或所属实例关闭
- **THEN** SHALL 不再接受依赖该关联的回复，不从会话历史恢复旧关联
- **AND** 查不到记录 MUST 不被解释为远端没有执行
- **AND** 本地过期提示 SHALL 不自动重发业务任务

### Requirement: 业务消息进入会话历史

收到的业务消息 SHALL 以带来源和关联信息的自定义消息展示，并按投递策略触发处理；普通模型回答 MUST 不自动回传给发件人。

#### Scenario: 查看长消息

- **WHEN** 人类查看折叠或展开的 peer 消息
- **THEN** 正文 SHALL 分别最多展示 1000 或 50000 个字符，超限时标明显示截断
- **AND** 完整正文 SHALL 仍保留在会话历史；来源与权限边界见[安全档案](../peer-security/archive.md)
