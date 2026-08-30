# Agent Note: OIDC token 端点 HTTP 201 响应兼容

Status: implemented

[English](2026-08-30-oidc-token-created-response-compatibility.md) | 中文

## Problem

OAuth 2.0 token 成功响应使用 HTTP 200，`openid-client` 会在解析或验证响应正文前拒绝其他状态码。部分 OIDC 提供方会在授权码交换时随一份其他方面均有效的 token 响应返回 HTTP 201。接受所有成功 2xx 状态的客户端可以使用这些提供方，而 Harness 会在 ID Token 验证前拒绝相同交换。

Harness 不能为兼容响应状态缺陷而削弱 token、PKCE、state、nonce、issuer、audience、签名或重放验证。使用合规提供方的部署也必须保留严格的状态处理。

## Decision

`host-auth-web` 插件公开默认值为 `false` 的 `oidcTokenEndpointCreatedCompatibility`。启用后，仅当传出表单正文包含 `grant_type=authorization_code` 时，OIDC 客户端的 fetch 钩子才会把 HTTP 201 改为 HTTP 200。替代响应保留原始响应头与正文，因此 `openid-client` 仍会解析 token 响应并执行全部常规 OIDC 验证。

该钩子不改变发现、授权、JWKS 与非授权码请求，也不改变 201 以外的任何状态，包括其他成功 2xx 状态和所有提供方错误。

## Testing

组装认证路由测试会启用该选项，并针对 token 端点返回 HTTP 201 的本地签名 OIDC 提供方完成一次 PKCE 登录。同一测试还会把提供方响应改为 HTTP 202，并要求回调失败且不签发另一会话。

## Alternatives considered

**要求提供方返回 HTTP 200。** 这是更理想的提供方行为，但 Harness 部署并不总能控制 OIDC 实现或其发布计划。

**接受所有 HTTP 2xx 响应。** 不采用，因为观测到的提供方只需要兼容 201，而更宽泛的规范化会掩盖未经分析的状态语义。

**用手写交换替换 `openid-client` 的 token 处理。** 不采用，因为这会仅为改变一个 HTTP 状态而重复实现对标准敏感的响应解析和 ID Token 验证。

## Consequences

管理员可以让一个部署选择兼容观测到的提供方行为，而不改变 OIDC 身份或密码学验证。默认行为仍符合标准。启用的部署会有意向 `openid-client` 隐藏原始 201 状态，因此运维人员必须仅对随该状态返回完整有效 token 响应的提供方使用此选项。
