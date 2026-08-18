# @deepseek-ai/dsh-auth-file

[English](README.md) | 中文

`ctx.auth` 的仅属主可访问 JSON 提供方。本地密码使用带盐 scrypt 记录，浏览器会话只持久化 SHA-256 令牌摘要，停用用户会撤销其全部活动会话。

## 配置

- `root` 默认为 `<DSH_HOME>/server`。
- `sessionTtlHours` 默认为 12。
- `bootstrapUsername` 默认为 `admin`。
- `bootstrapPasswordEnv` 默认为 `HARNESS_BOOTSTRAP_PASSWORD`。

用户文件不存在时，提供方会创建一个管理员。密码优先读取配置的环境变量；环境变量不存在时，会生成一次性密码，并且只写入启动日志。

## 存储约定

认证状态位于 `<root>/system/auth/users.json`、`sessions.json`、`preferences.json` 和 `oidc.json`，这些文件都以 `0600` 权限原子替换。OIDC 文件保存非敏感客户端参数和不可变的 `(issuer, sub) → UserId` 绑定；客户端密钥仍由 credentials 提供方保存。偏好文件只保存启用管理员统一 DeepSeek 凭据的用户 id。用户数据位于 `<root>/users/<UserId>/`，目录权限为 `0700`。用户名绝不会成为路径片段。

## 模型体验

无，因为本提供方不会添加任何模型可见内容。

#### KV Cache 影响

无。

## 已知限制与暂缓工作

- JSON 提供方只在单进程内串行化写入；不支持多个 Harness 服务进程共享同一数据根目录。
- OIDC 身份不会按用户名自动关联本地账号。首选用户名冲突时会添加确定性后缀，管理员可在首次登录后继续管理该 Harness 账号的角色。
