---
description: "用于匿名安装标识、多用户服务器账号和签名桌面设备授权的 identity 包。"
kind: "package-group"
---

# identity/ — 共享身份

[English](README.md) | 中文

## 概述

identity 组包含匿名安装 id、服务器认证能力接口与文件提供方，以及授权打包桌面设备所用的密码学协议。服务器用户和桌面设备都使用不透明的稳定 id；用户名从不选择存储路径。每个包的 README 负责说明其存储与信任规则。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

| 包 | 职责 |
|---|---|
| [`anonymous-user-id`](anonymous-user-id/README.zh.md) | 让每个 harness home 拥有一个匿名 id，遥测、反馈与 DeepSeek 请求把它附加到记录上，使来自同一安装的记录无需识别用户即可被辨认 |
| [`auth`](auth/README.zh.md) | 服务器用户、角色、OIDC 绑定、路径和桌面设备能力定义 |
| [`auth-file`](auth-file/README.zh.md) | 账号、浏览器会话、OIDC 身份和桌面设备的仅所有者文件提供方 |
| [`desktop-auth`](desktop-auth/README.zh.md) | 签名激活、设备证明、离线授权和加密单位模型配置 |

<a id="related-documentation"></a>
## 相关文档

- [会话遥测子系统](../../docs/subsystems/session-telemetry.zh.md)——在导出中携带该 id 的遥测功能。
- [dsh-llm-deepseek](../llm/llm-deepseek/README.zh.md)——在请求中携带该 id 的 DeepSeek 提供方。
- [dsh-command-feedback](../feedback/command-feedback/README.zh.md)——在确认文本中点名该匿名安装的反馈命令。

<a id="dev-note"></a>
## 开发备注

无。
