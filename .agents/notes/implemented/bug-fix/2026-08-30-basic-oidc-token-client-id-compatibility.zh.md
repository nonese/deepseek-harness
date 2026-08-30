# Agent Note: Basic OIDC 令牌请求携带公开 client id

Status: implemented

[English](2026-08-30-basic-oidc-token-client-id-compatibility.md) | 中文

## 问题

OIDC 依赖方此前只通过 HTTP Authorization 标头认证 `client_secret_basic` 令牌请求。部分提供方会在授权码无效时成功认证该标头，但会使用表单正文中的 `client_id` 定位或验证真实授权码绑定的客户端。即使发现文档、客户端密钥、注册的认证方式和 redirect URI 都有效，这类提供方仍会以 `invalid_client` 拒绝回调交换。

将配置方式改成 `client_secret_post` 虽然会使这类提供方接受另一种请求，但它不符合客户端已注册的认证方式，还会把密钥移入表单正文。

## 决策

每次授权码令牌交换都会把已配置的公开 client id 作为附加表单参数传入。`openid-client` 继续应用选定的认证方式，因此 `client_secret_basic` 仍只在 Authorization 标头发送密钥，`client_secret_post` 也保留其配置行为。PKCE、state、nonce、ID Token 验证、待完成流程过期与重放拒绝均保持不变。

client id 来自待完成 OIDC 流程捕获的不可变设置。回调会在发出令牌请求前拒绝设置或密钥指纹已经变化的流程，因此标头凭据与表单 client id 始终属于同一份配置。

## 验证

带签名的本地 OIDC 提供方可以同时要求有效 Basic 凭据和表单正文中的公开 client id，并拒绝正文中出现客户端密钥。完整 PKCE 登录测试会启用该行为，并证明令牌交换、签名 ID Token 验证、隔离用户创建、管理员路由拒绝与回调重放拒绝均成功。

## 考虑过的替代方案

**将部署改为 `client_secret_post`。** 被拒绝，因为提供方为该客户端注册的是 `client_secret_basic`；修改认证方式会违反部署设置，并在不同的请求组成部分中暴露密钥。

**只通过表单正文中的 client id 与密钥认证。** 被拒绝，因为这属于 `client_secret_post`，不是对已配置 Basic 方式的兼容调整。

**只对一个 issuer 做特殊处理。** 被拒绝，因为不需要该字段的提供方也能安全接收额外的公开标识符，而 issuer 专用行为会增加一个没有通用意义的部署开关，并让同类提供方继续失败。

## 后果

令牌请求会包含两次公开 client id：一次作为 Basic 凭据的一部分，另一次作为表单字段。密钥仍只通过已配置的认证机制发送。这项轻量冗余支持通过表单字段绑定真实授权码的提供方，同时不会削弱 PKCE 或回调验证。
