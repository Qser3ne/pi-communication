# peer-delivery-control

## Purpose

定义收到 peer 业务消息后的调度、暂停恢复、取消及容量限制。

## Requirements

### Requirement: followUp 与 steer 调度

followUp SHALL 在最终空闲且无待处理宿主消息时交给 Pi；steer SHALL 在宿主运行时交给 Pi 的 steer 队列，不强制终止正在执行的工具。

#### Scenario: 对端正在运行工具

- **WHEN** 同时收到 followUp 和 steer 消息
- **THEN** followUp SHALL 保留至可继续处理时，steer SHALL 由 Pi 在当前工具之后处理
- **AND** 同一投递类别的插件排队消息 SHALL 按接收先后取出，不因空闲交接窗口让后来消息越过先前消息

#### Scenario: 压缩或树导航

- **WHEN** 宿主正在压缩或树导航等维护操作
- **THEN** 两种投递 SHALL 均保留在扩展队列，直到观察到维护结束后的可处理状态
- **AND** 没有最终 settled 事件的维护完成 SHALL 由约 1 秒的检查周期恢复调度，不宣称零延迟

### Requirement: 显式暂停与恢复

/peers pause SHALL 暂停自动注入并拒收新的业务消息；/peers resume SHALL 恢复接收和排队处理。MUST 不撤回已经提交给 Pi 的消息。

#### Scenario: 暂停后收到新消息

- **WHEN** 暂停期间收到新的 request、notification 或 reply
- **THEN** SHALL 明确拒绝为 paused，已有未提交队列仍保留至恢复或过期
- **AND** 无效 /peers 参数 SHALL 仅显示用法，不切换暂停状态

#### Scenario: 用户中止

- **WHEN** agent_settled 标记 aborted，或维护操作被中止
- **THEN** SHALL 暂停 peer 自动注入，记录恢复提示
- **AND** MUST 等待显式 /peers resume，不自动续跑排队业务

### Requirement: 队列容量与观察确认

待提交及已提交但尚未在 context 中观察到的消息 SHALL 共同占用最多 100 条容量；MUST 不仅因调用注入接口成功就释放容量。

#### Scenario: 观察到已提交消息

- **WHEN** 当前实例的消息进入 Pi context
- **THEN** SHALL 释放对应容量，重复观察不重复释放
- **AND** 队列满时 SHALL 明确返回 queue_full，不无限等待

### Requirement: 限流及有界去重

业务消息 SHALL 按来源实例限制为每分钟 30 条；去重记录 SHALL 最多 1000 条，通常保留 10 分钟，仍待处理的记录不得提前逐出。

#### Scenario: 重复或冲突的消息标识

- **WHEN** 相同来源和 messageId 的相同内容再次到达
- **THEN** SHALL 返回原收件确认，不重复排队或消耗新的限流次数
- **AND** 相同标识内容不同，或与其他待处理消息的 messageId 冲突时 MUST 拒绝
- **AND** 去重容量耗尽或来源限流时 SHALL 明确拒绝，不靠无限扩容接收

### Requirement: 排队过期与注入失败

未提交消息 SHALL 在接收后 10 分钟过期；注入异常 SHALL 移除该待处理消息并发送 dropped 回执，MUST 不自动重试。

#### Scenario: 消息已提交

- **WHEN** 先前消息已交给 Pi 但尚未观察到 context
- **THEN** SHALL 不按未提交消息的排队期限将其再次投递
- **AND** 关闭实例 SHALL 停止后续注入，并将仍未提交的消息按过期处理

### Requirement: 控制信息与无 UI 运行

/peers 的结果 SHALL 记录为不触发模型的可见条目；暂停期间的空闲、退出和过期等自动通知 SHALL 只显示和记录，不唤醒模型。

#### Scenario: 无 UI 模式

- **WHEN** 没有交互 UI 而执行控制命令或收到仅记录通知
- **THEN** SHALL 不打开对话框，仍可通过会话条目读取结果
- **AND** 未暂停的自动通知 SHALL 可作为带警示的 followUp 消息触发处理，不代表业务完成
