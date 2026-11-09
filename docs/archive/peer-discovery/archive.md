# peer-discovery

## Purpose

定义同机独立 Pi 会话的发现、寻址和实例生命周期，不负责启动或恢复其他会话。

## Requirements

### Requirement: 宿主与发现范围

本扩展 SHALL 只发现同一机器、共享同一注册目录且已加载本扩展的在线实例；MUST 不创建、启动或恢复会话。运行环境 SHALL 为 Linux/macOS、Node.js >=22.19.0 和 Pi >=1.5.0。

#### Scenario: 列出在线会话

- **WHEN** 调用 peer_list
- **THEN** SHALL 返回其他在线实例的 name、instanceId、sessionId、cwd、activity、paused 和受支持的 features，不包含自身
- **AND** 分页遵守[消息接口](../peer-messaging/archive.md)的公共规则，敏感信息输出遵守[安全边界](../peer-security/archive.md)
- **AND** 无法验证为在线的注册记录 SHALL 不出现在结果中

### Requirement: 实例级身份

每次会话启动 SHALL 生成新的 instanceId；寻址 MUST 同时绑定 sessionId 和 instanceId，不将旧地址转发到新实例。

#### Scenario: 会话替换或重载

- **WHEN** 会话新建、恢复、fork、重载或进程重新启动
- **THEN** SHALL 使用新的实例身份，旧实例关闭后不再被发现
- **AND** 相同 sessionId 的两个在线实例 SHALL 可独立存在，不视为同一收件人

### Requirement: 可消歧的目标解析

目标 SHALL 支持完整 instanceId、唯一 sessionId、唯一名称及「名称 [实例前缀]」；名称匹配 SHALL 忽略大小写并规范化首尾空白和兼容字符。MUST 拒绝任意 socket 地址及包含路径分隔符的目标。

#### Scenario: 目标重名

- **WHEN** 名称或 sessionId 匹配多个在线实例
- **THEN** SHALL 返回 ambiguous_target，不任意选择收件人
- **AND** 使用足够长的实例前缀或完整 instanceId SHALL 可明确选择目标

#### Scenario: 名称变化或目标失效

- **WHEN** 会话名称更新，或目标退出后继续向旧地址发送
- **THEN** 名称更新 SHALL 反映到后续发现结果，实例身份不因此改变
- **AND** 已失效目标 SHALL 返回不可用，不自动恢复或换成同名会话

### Requirement: 人类可见的会话列表

/peers SHALL 显示自身身份、暂停或忙闲状态，以及最多 100 个其他在线实例的名称、实例短标识、状态与目录；MUST 不为列表打开选择对话框或触发模型。

#### Scenario: 无其他在线实例

- **WHEN** 执行不带参数的 /peers 且没有其他可发现实例
- **THEN** SHALL 明确显示没有其他在线会话，并把结果记入可见的会话条目
- **AND** 有 UI 时 SHALL 同时通知；超过列表上限时提示使用 peer_list 分页

### Requirement: 注册目录配置

默认注册目录 SHALL 位于 Pi agent directory 的 communication 下，并遵循 PI_CODING_AGENT_DIR；communication/config.json 的 registryRoot SHALL 可显式指定绝对注册路径。

#### Scenario: 使用自定义目录

- **WHEN** 各实例使用不同 agent directory 或 registryRoot
- **THEN** SHALL 仅发现各自注册目录内可验证的实例，不自动跨目录搜索
- **AND** 非法配置或不安全路径 MUST 拒绝使用；存储权限遵守[安全边界](../peer-security/archive.md)
