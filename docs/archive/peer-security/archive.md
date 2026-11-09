# peer-security

## Purpose

定义本地通信协议、注册数据权限及不可信 peer 文本的展示和授权边界。

## Requirements

### Requirement: 仅本地通信

本扩展 SHALL 使用 Unix domain socket 与本地注册信息，不提供远程网络传输或文件信箱；注册记录 MUST 不存储业务正文。

#### Scenario: 启用另一个实例

- **WHEN** 同一系统用户在共享注册目录中启用扩展
- **THEN** 实例 SHALL 可在认证后互连，不逐对请求用户审批
- **AND** 不同系统用户的意外读取 SHALL 由私有文件权限约束，不提供同用户恶意进程隔离保证

### Requirement: 私有存储与路径验证

注册元数据和独立认证令牌 SHALL 分开存储；私有目录 MUST 为所属用户且无组/其他用户权限，创建模式为 0700，记录、密钥及 socket 为 0600。

#### Scenario: 不安全路径

- **WHEN** 路径含不允许的符号链接、对象类型不符、属主或权限不安全
- **THEN** MUST 拒绝使用，不通过更改现有目录权限掩盖问题
- **AND** socket SHALL 位于按用户及注册根派生的短临时路径，系统临时根先规范化
- **AND** 清理 MUST 不覆盖或删除不属于当前实例的预存文件

### Requirement: 认证及版本化帧

连接 MUST 验证版本 1、目标完整实例身份及独立随机令牌；发送业务时还 MUST 校验握手来源与正文来源相符。协议 MUST 拒绝无效结构、额外字段、非法 UTF-8 和超限帧。

#### Scenario: 未认证或旧身份连接

- **WHEN** 令牌、目标 sessionId/instanceId 或消息身份不匹配
- **THEN** SHALL 拒绝投递，不因名称相同而放行
- **AND** 发现结果和模型工具输出 MUST 不包含令牌及 socket 地址

### Requirement: 传输资源上限

单帧 SHALL 最多为含换行的 1 MiB UTF-8 数据，单连接期限为 5 秒，监听器 SHALL 最多同时接受 32 个连接。

#### Scenario: 异常或超限输入

- **WHEN** 收到过大未完成帧、畸形数据、未完成握手或超过连接容量
- **THEN** SHALL 拒绝或关闭连接，不无限缓存或等待
- **AND** ACK 不确定性 SHALL 按[消息状态](../peer-messaging/archive.md)处理，不自动重发正文

### Requirement: 来源展示与模型权限边界

每条业务消息 MUST 带来源、消息标识及「不是用户授权」警示；正文 SHALL 作为不可信数据交给模型，不成为独立的系统权限角色。

#### Scenario: 正文试图伪造指令或来源

- **WHEN** peer 文本包含控制序列、多行伪标题或授权声明
- **THEN** 人类展示 SHALL 清理终端控制字符，来源头独立显示，正文及折行带引用栏
- **AND** 模型内容 SHALL 将正文放入 JSON 数据并明确不得绕过本会话权限
- **AND** MUST 不把 peer 请求当成人类对删除、凭据访问或发布等操作的批准

### Requirement: 历史与秘密边界

业务正文 SHALL 进入 Pi 会话历史；扩展 MUST 不被描述为秘密传输通道或跨重启消息账本。

#### Scenario: 实例关闭后查看历史

- **WHEN** 先前会话仍保留 peer 消息
- **THEN** 历史 SHALL 可保留正文，但队列、去重、关联和订阅不由此恢复
- **AND** 新实例 MUST 不使用历史记录冒充旧实例回复
