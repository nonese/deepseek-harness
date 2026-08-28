---
description: "面向角色、浏览器主体、OIDC 身份绑定、统一模型偏好与稳定用户数据路径的服务端认证定义。"
kind: "package-reference"
---

# @deepseek-ai/dsh-auth

[English](README.md) | 中文

## 概述

使用本包可让服务端组合统一描述认证用户、管理员授权、浏览器主体、OIDC 身份绑定与程序管理的用户路径。每个数据目录始终由稳定的随机 `UserId` 选择，不使用用户名或显示名称。本包只定义能力，不自行保存凭据值；需要组合 `@deepseek-ai/dsh-auth-file` 等提供方来提供 `ctx.auth`。

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

### 组合

提供方通过 `ctx.auth` 提供能力。HTTP 和 WebSocket 传输在构造用户级 API 视图之前验证不透明 Cookie。产品界面只能获得 `AuthUser`；密码记录与会话令牌摘要始终属于提供方私有数据。本服务保存非敏感 OIDC 客户端参数、不可变的 issuer 与 subject 身份绑定、用户是否启用管理员统一 DeepSeek 凭据的选择，并且在不使用用户名的前提下解析项目路径的所有者。

### 存储约定

`UserPaths` 在同一用户目录下分隔项目、运行状态、设置、凭据、会话和附件。提供方以仅属主可访问的权限创建这些目录。修改用户名不会迁移数据。OIDC 登录只通过已验证的 `(issuer, sub)` 解析已有账号；可变的用户名与显示名称声明不能选择本地账号。统一 DeepSeek 选择和 OIDC 客户端参数属于认证元数据而非凭据内容。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`AuthService` 是 Cordis 服务定义。请求主体通过异步上下文传播，使 HTTP、WebSocket、RPC 与工具策略代码能在一次分发期间读取同一份不可变身份，而不必向每个方法添加身份字段。提供方实现持久账号、会话、OIDC、偏好和路径操作；载体完成请求认证并建立主体。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [认证子系统](../../../docs/subsystems/authentication.zh.md)——身份、会话、路径与授权语义。
- [auth-file](../auth-file/README.zh.md)——面向单进程的仅属主可访问 JSON 提供方。
- [host-auth-web](../../host/auth-web/README.zh.md)——浏览器路由、OIDC 交换与请求授权。

-----

<a id="model-experience"></a>
## 模型体验

无，因为认证只控制运行时访问，不会添加提示词或模型可见内容。

#### KV Cache 影响

无。

## 已知限制与暂缓工作

<a id="known-limitations-and-deferred-work"></a>

- 本服务接收已经验证的 OIDC 声明；发现、令牌交换和 ID Token 验证仍由部署适配器负责。
- 应用层隔离无法防御运行在受信 Host 进程内的恶意插件。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
