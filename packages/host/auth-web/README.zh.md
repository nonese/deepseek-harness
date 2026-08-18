# @deepseek-ai/dsh-host-auth-web

[English](README.md) | 中文

Harness 登录页、本地与 OIDC 浏览器会话、用户管理与程序化项目创建所使用的同源 HTTP 路由。

## 路由

`GET /auth/session`、`POST /auth/login/local`、`GET /auth/oidc/start`、`GET /auth/oidc/callback` 与 `POST /auth/logout` 管理浏览器会话。OIDC 使用 Authorization Code、PKCE S256、state、nonce、提供方发现，以及通过轮换 JWKS 完成的签名 ID Token 验证。待完成流程只保存在进程内存中，生命周期为十分钟，并绑定一个匹配的 `HttpOnly`、`SameSite=Lax` 临时 Cookie；回调重放不能再次签发会话。已认证用户只能列出并创建自己生成数据根目录下的项目。`GET` 与 `PATCH /auth/preferences` 只公开和修改当前用户是否启用统一 DeepSeek 凭据；管理员凭据不存在时，启用操作会失败。

管理员可以读取实际生效的进程、存储、认证、隔离、请求限制与统一模型状态，列出用户元数据，创建本地用户，修改角色或状态并重置本地密码。`PUT /auth/system/oidc` 保存 issuer、client id、redirect URI、scopes、客户端鉴权方式、可选的内网 HTTP 例外和首次登录管理员组。提交的客户端密钥通过现有 credentials 提供方写入 `HARNESS_OIDC_CLIENT_SECRET`，绝不回传。`POST /auth/system/oidc/test` 在不签发令牌的前提下验证已保存的发现文档。`PUT` 与 `DELETE /auth/system/shared-deepseek` 用于替换或移除专用统一模型凭据。管理响应只公开是否配置和是否可写，绝不返回提交或已存储的密钥，也不会返回用户项目或会话内容。

在已认证的 Web 组合中，本插件还会为所有 `cordis_*` 工具注册单调执行守卫。守卫在每次调用时都会从调用 Agent 的程序管理项目路径解析当前所有者，只有该所有者当时仍是管理员才会调用工具主体。没有 Agent、没有受管所有者、所有者为普通用户或已被降级的调用都会在工具主体前失败。Preset 与 Remote runner 的准入另由作用域 API 代理和 Connection 载体独立执行。

不透明 Cookie 使用 `HttpOnly` 和 `SameSite=Lax`，并可启用 `Secure`。可变更路由会拒绝不匹配的 `Origin`、限制 JSON 请求体大小并返回稳定错误码。issuer 和回调地址默认必须使用 HTTPS，只有管理员显式启用纯内网 HTTP 例外后才可使用 HTTP。OIDC 声明只通过已验证的 issuer 与 subject 创建或恢复账号；首选用户名不能接管已有本地账号。配置的管理员组只在外部身份首次创建时生效，此后的角色变更由 Harness 管理员负责。

## 模型体验

### 动态 Cordis 拒绝

#### 模型看到的内容

该策略不添加提示词内容。被拒绝的 `cordis_*` 尝试会变成普通工具失败 `Error: 仅管理员可使用动态 Cordis 插件`；管理员调用不受影响。

#### Token 影响

在被拒绝的调用作为普通工具结果追加之前为无。

#### KV Cache 影响

拒绝发生后只会追加内容；之前的请求前缀仍可复用。

## 已知限制与暂缓工作

- 身份提供方没有 end-session 或令牌撤销端点，因此 Harness 退出只撤销本地浏览器会话，不会同时退出上游身份提供方。
- 终止 TLS 的部署必须启用 `secureCookie`。
