---
description: "面向 Harness Web 服务端的同源本地与 OIDC 登录、浏览器会话授权、管理员控制、用户项目创建与文件访问，以及统一模型偏好。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-auth-web

[English](README.md) | 中文

## 概述

使用本包可把 Harness Web 组合变成登录后才能访问的单进程多用户服务。它提供本地与 OIDC 登录路由、持久浏览器会话授权、管理员控制、用户项目创建与文件访问，以及用户是否启用管理员统一模型站点的选择。普通用户只能获得自己的会话、workspace、项目与事件流；管理员命名空间和动态 Cordis 变更仍仅限管理员。

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

### 路由

`GET /auth/session`、`POST /auth/login/local`、`GET /auth/oidc/start`、`GET /auth/oidc/callback` 与 `POST /auth/logout` 管理浏览器会话。OIDC 使用 Authorization Code、PKCE S256、state、nonce、提供方发现，以及通过轮换 JWKS 完成的签名 ID Token 验证。待完成流程只保存在进程内存中，生命周期为十分钟，并绑定一个匹配的 `HttpOnly`、`SameSite=Lax` 临时 Cookie；回调重放不能再次签发会话。若提供方的授权码 token 端点随有效 token 响应返回 HTTP 201，则可启用 `oidcTokenEndpointCreatedCompatibility`；其默认值 `false` 保留标准的 HTTP 200 要求。已认证用户只能列出并创建自己生成数据根目录下的项目。`GET /auth/projects/:id/files` 列出一个项目相对目录，`/preview` 返回大小受限的 UTF-8 文本，`/download` 以附件方式流式传输一个普通文件，`PUT /upload` 则把一个文件流式写入所选目录且不替换同名文件。每条文件路由都只会在当前已认证用户的受管 workspace 中解析项目 ID，拒绝路径越界和符号链接，并省略隐藏条目。`GET` 与 `PATCH /auth/preferences` 只公开和修改当前用户是否启用全部管理员统一模型站点；所有站点都没有配置凭据时，启用操作会失败。

`projectFileMaxEntries` 限制单次目录响应，默认为 1,000 个可见条目。`projectFilePreviewMaxBytes` 限制单次文本预览，默认为 512 KiB。`projectFileUploadMaxBytes` 限制单文件流式上传，默认为 50 MiB；下载和上传都保持流式传输，不会整体缓冲到应用内存。

经过认证的 `credentials` Remote namespace 只描述、存储和移除当前用户的环境风格引用。本插件在现有部署凭据存储中按不透明用户 ID 各保存一条 `api-key` 记录，绝不向浏览器返回值，并且只向匹配用户投影更新事件。LLM 与 web 搜索 provider 根据持久会话所有者解析该 scope。管理员统一引用仍为进程级，并且只有所有者显式启用统一模型偏好后，生成或 DeepSeek 搜索才能使用它们。

管理员可以读取实际生效的进程、存储、认证、隔离、请求限制与统一模型状态，列出用户元数据，创建本地用户，修改角色或状态并重置本地密码。`PUT /auth/system/oidc` 保存 issuer、client id、redirect URI、scopes、客户端鉴权方式、可选的内网 HTTP 例外和首次登录管理员组。提交的客户端密钥通过现有 credentials 提供方写入 `HARNESS_OIDC_CLIENT_SECRET`，绝不回传。`POST /auth/system/oidc/test` 在不签发令牌的前提下验证已保存的发现文档。`PUT` 与 `DELETE /auth/system/managed-models/deepseek-official` 替换或移除 DeepSeek 官方站点凭据。`PUT /auth/system/managed-models/deepseek-official/models` 从官方适配器目录中保存管理员选择的一至 32 个 ID 到 `llm-deepseek.sharedModels`；旧设置没有该值时默认使用 V4 Flash。`POST /auth/system/managed-models/discover` 使用一次性 Key 或指定自定义站点的已存储 Key 请求 OpenAI 兼容的 `/models` 端点，并返回不含密钥的候选模型。模型 ID 可包含中间空格；模型发现会省略开头或结尾带空白、包含控制字符以及超过 128 个字符的 ID，提交的 ID 则会先经过规范化与首尾空白移除再存储。`POST /auth/system/managed-models/sites` 使用显示名称、Base URL、已选模型 ID 和独立凭据新增站点；`PUT` 与 `DELETE /auth/system/managed-models/sites/:id` 修改或移除该站点。自定义 profile 使用 `llm-pi-ai` 设置分节中保留的 `managed-*` 路由和仅服务端可见的凭据引用。管理响应只公开是否配置和是否可写，绝不返回提交或已存储的密钥，也不会返回用户项目或会话内容。

在已认证的 Web 组合中，本插件会注册唯一的 Connection 认证器和有序 Typert Gateway 中间件。认证器校验持久 Cookie，并为 HTTP 与 WebSocket 分发提供请求主体；每条已接受的多路复用 WebSocket 都为所有逻辑流保留这份授权。中间件在缺少当前用户身份时关闭访问，过滤用户拥有的 Session、Workspace、Host 信息、列表与 stream，并拒绝普通用户访问管理员命名空间。独立的单调执行守卫保护每个 `cordis_*` 工具：它在每次调用时从调用 Agent 的程序管理项目路径解析当前所有者；没有 Agent、没有受管所有者、所有者为普通用户或已被降级的调用都会在工具主体前失败。

不透明 Cookie 使用 `HttpOnly` 和 `SameSite=Lax`，并可启用 `Secure`。可变更路由会拒绝不匹配的 `Origin`、限制 JSON 请求体大小并返回稳定错误码。issuer 和回调地址默认必须使用 HTTPS，只有管理员显式启用纯内网 HTTP 例外后才可使用 HTTP。OIDC 声明只通过已验证的 issuer 与 subject 创建或恢复账号；首选用户名不能接管已有本地账号。配置的管理员组只在外部身份首次创建时生效，此后的角色变更由 Harness 管理员负责。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

部署认证器在 HTTP 或 WebSocket RPC 分发前验证 Cookie，并在认证服务的异步上下文中建立所得 `AuthPrincipal`。有序 Typert 中间件对普通调用、流与事件跟随分别执行方法级所有权过滤。工具策略会在实际执行时再次解析所有权，防止角色降级或项目所有者变化后复用旧的准入结果。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [认证子系统](../../../docs/subsystems/authentication.zh.md)——全服务的身份、会话、存储与授权行为。
- [auth](../../identity/auth/README.zh.md)——请求主体与用户路径定义。
- [auth-file](../../identity/auth-file/README.zh.md)——持久用户、会话、OIDC 绑定与偏好。
- [Connection](../../client/connection/README.zh.md)——传输分发前的部署认证。
- [Gateway](../../api/gateway/README.zh.md)——有序 RPC 授权中间件。

-----

<a id="model-experience"></a>

## 模型体验

### 动态 Cordis 拒绝

#### 模型看到的内容

该策略不添加提示词内容。被拒绝的 `cordis_*` 尝试会变成普通工具失败 `Error: 仅管理员可使用动态 Cordis 插件`；管理员调用不受影响。

#### Token 影响

在被拒绝的调用作为普通工具结果追加之前为无。

#### KV Cache 影响

拒绝发生后只会追加内容；之前的请求前缀仍可复用。

## 已知限制与暂缓工作

<a id="known-limitations-and-deferred-work"></a>

- 身份提供方没有 end-session 或令牌撤销端点，因此 Harness 退出只撤销本地浏览器会话，不会同时退出上游身份提供方。
- 终止 TLS 的部署必须启用 `secureCookie`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
