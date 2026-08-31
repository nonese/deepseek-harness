---
description: "凭据能力族的包映射：凭据引用 seam、环境与文件提供方、授权 flow 注册表，以及引用如何让机密值留在配置之外。"
kind: "package-group"
---

# credentials/：凭据与授权

[English](README.md) | 中文

## 概述

`credentials/` 组管理配置按名称引用的机密值。它提供共享能力接口（`credentials/`）、默认本地 YAML 提供方（`credentials-local/`）、Windows 桌面 DPAPI 提供方（`credentials-windows/`）以及需要人工授权的流程注册表（`authorization/`）。轮换后的密钥会在下一次模型请求中生效。普通配置文件只保存引用名称，不保存机密值。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

三个包共同提供凭据功能：一个在运行时存储、查询与移除机密，而配置只写名字；第二个是默认的本机存储；第三个让插件获取必须开口去要的凭据。它们的 README 覆盖日常使用；子系统参考拥有穷尽式约定。

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`credentials/`](credentials/README.zh.md) | 在运行时存储、查询与移除机密，而配置只写名字 | `ctx.credentials` |
| [`credentials-local/`](credentials-local/README.zh.md) | 默认本机存储：一个私有 YAML 文件，环境覆盖优先 | 注册 `ctx.credentials` |
| [`credentials-windows/`](credentials-windows/README.zh.md) | Windows 桌面存储：一个 CurrentUser DPAPI 加密文档 | 注册 `ctx.credentials` |
| [`authorization/`](authorization/README.zh.md) | 由插件拥有、通过询问人来取得凭据的 flow | `ctx.authorization` |

-----

<a id="related-documentation"></a>
## 相关文档

先从子系统参考了解共享词汇，再看能力 seam 表与本地存储的配置面。

- [凭据子系统参考](../../docs/subsystems/credentials.zh.md)——`CredentialRef` 与 `CredentialKey`、按操作解析、对 UI 安全的 `CredentialInfo`、授权 flow 与生成的 cordis 接口面。
- [能力 seam](../../docs/capability-seams.zh.md)——本家族遵循的 Service Definition / Service Provider / Consumer 拆分。
- [生成配置目录](../../docs/config-catalog.zh.md#deepseek-aidsh-credentials-local)——本地存储的每个受支持字段。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
