---
description: "面向本地用户、浏览器会话、OIDC 绑定、偏好与用户目录的单进程仅属主可访问 JSON 认证存储。"
kind: "package-reference"
---

# @deepseek-ai/dsh-auth-file

[English](README.md) | 中文

## 概述

当一个长期运行的 Harness 服务进程需要在没有独立数据库的情况下持久保存多个用户时，选择本提供方。它把认证记录保存为仅属主可访问的 JSON 文件，创建稳定的用户目录，使用带盐 scrypt 哈希本地密码，并且只保存浏览器会话令牌的 SHA-256 摘要。停用账号会撤销它的全部活动会话。多个服务进程不得共享同一数据根目录。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 配置

- `root` 默认为 `<DSH_HOME>/server`。
- `sessionTtlHours` 默认为 12。
- `bootstrapUsername` 默认为 `admin`。
- `bootstrapPasswordEnv` 默认为 `HARNESS_BOOTSTRAP_PASSWORD`。
- `bootstrapAdministrator` 默认为 `true`。只有不提供登录入口的封闭运行时（例如浏览器内预览）才可设为 `false`。

用户文件不存在时，提供方会创建一个管理员。密码优先读取配置的环境变量；环境变量不存在时，会生成一次性密码，并且只写入启动日志。

### 存储约定

认证状态位于 `<root>/system/auth/users.json`、`sessions.json`、`preferences.json` 和 `oidc.json`，这些文件都以 `0600` 权限原子替换。OIDC 文件保存非敏感客户端参数和不可变的 `(issuer, sub) → UserId` 绑定；客户端密钥仍由 credentials 提供方保存。偏好文件只保存启用管理员统一 DeepSeek 凭据的用户 id。用户数据位于 `<root>/users/<UserId>/`，目录权限为 `0700`。用户名绝不会成为路径片段。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

提供方在单个进程内串行化变更，并原子替换每个带版本的 JSON 文档。密码验证先完成 scrypt 派生，再以恒定时间比较摘要；会话查询会先哈希收到的不透明令牌再作比较。目录所有权只从稳定用户 id 派生。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [认证子系统](../../../docs/subsystems/authentication.zh.md)——持久身份与路径语义。
- [auth](../auth/README.zh.md)——本提供方实现的服务定义。
- [host-auth-web](../../host/auth-web/README.zh.md)——消费本提供方的浏览器与 OIDC 适配器。

-----

<a id="model-experience"></a>

## 模型体验

无，因为本提供方不会添加任何模型可见内容。

#### KV Cache 影响

无。

## 已知限制与暂缓工作

<a id="known-limitations-and-deferred-work"></a>

- JSON 提供方只在单进程内串行化写入；不支持多个 Harness 服务进程共享同一数据根目录。
- OIDC 身份不会按用户名自动关联本地账号。首选用户名冲突时会添加确定性后缀，管理员可在首次登录后继续管理该 Harness 账号的角色。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
