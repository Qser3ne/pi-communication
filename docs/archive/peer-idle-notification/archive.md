# peer-idle-notification

## Purpose

定义面向精确实例的一次性空闲订阅，区分空闲、退出、过期和业务完成。

## Requirements

### Requirement: 独立的一次性订阅

peer_send 的 notifyWhenIdle=true SHALL 可与正文一起发送，也可不带正文独立订阅；MUST 只向声明 notify_idle 能力的目标发起订阅。

#### Scenario: 同目标重复订阅

- **WHEN** 当前实例再次订阅相同目标
- **THEN** 新订阅 SHALL 替换旧订阅，不为同一目标积累无限等待
- **AND** 不支持能力的目标 SHALL 返回 unsupported_feature；订阅与正文的发送结果 SHALL 分别记录

### Requirement: 最终稳定空闲

目标 SHALL 仅在未暂停、最终空闲、没有宿主待处理消息、没有插件待处理消息及空闲交接时认定空闲，并使用约 750ms 去抖。

#### Scenario: 去抖期间重新忙碌

- **WHEN** 空闲通知尚未发出，目标开始新运行或接收业务
- **THEN** SHALL 取消本次空闲计时，重新等待符合条件的稳定空闲
- **AND** MUST 不把 message_end 本身当作最终空闲或任务完成

### Requirement: 通知关联与单次消费

通知 MUST 同时匹配订阅 ID 和目标实例身份；成功消费后 SHALL 移除订阅，不继续周期性推送空闲状态。

#### Scenario: 旧通知或重复通知

- **WHEN** 收到已被替换、已过期、身份不符或已经消费的通知
- **THEN** SHALL 不将其当作当前订阅的新结果
- **AND** 有效通知 SHALL 明示空闲并非请求完成证明，展示方式遵守[投递控制](../peer-delivery-control/archive.md)

### Requirement: 容量、期限与退出

每个实例的入站和出站订阅 SHALL 分别最多保留 32 个目标，有效期为 12 小时；MUST 不在重启后恢复。

#### Scenario: 目标正常退出或订阅到期

- **WHEN** 仍有有效订阅而目标正常关闭，或订阅达到期限
- **THEN** SHALL 尽力发送 exited 或 expired 通知，不伪报 idle
- **AND** 本地等待到期 SHALL 明确记录未确认空闲，不自动重试业务
- **AND** 突然终止或通知投递失败 MUST 不被描述为保证收到退出通知
