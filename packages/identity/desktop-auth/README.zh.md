---
description: "DSH 桌面激活、设备证明、离线授权以及按设备加密单位模型配置所用的 JOSE 基础能力。"
kind: "package-reference"
---

# @deepseek-ai/dsh-desktop-auth

[English](README.md) | 中文

## 概述

本包定义 Windows 桌面发行版使用的传输无关密码学能力。服务器签署绑定一把 Ed25519 签名公钥和一把 X25519 加密公钥的 OIDC 授权地址。设备证明自己持有签名私钥后获得有时限的离线授权，并解密仅为其 X25519 公钥加密的单位模型凭据。本包不存储密钥、设备、重放标识或账号。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

服务器使用 `signDesktopActivation`、`verifyDesktopDeviceProof`、`signDesktopLease`、`signDesktopConfigurationReceipt` 和 `encryptDesktopOrganizationConfig`。桌面客户端使用对应的验证与解密函数，并将服务器公钥固定在构建中。调用方必须把私钥保存在操作系统保护的存储中，并记录已经使用的证明标识以拒绝重放。

<a id="model-experience"></a>
## 模型体验

无，因为这些基础函数不注册提示词、工具或模型请求输入。

#### KV 缓存影响

无。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 本包不提供吊销传输；认证提供方和路由所有者负责执行设备与账号状态。
- 有效离线授权只有在重新连接服务器或到期时才能感知账号已被吊销。

<a id="dev-note"></a>
### 开发备注

运行 `pnpm exec vitest run packages/identity/desktop-auth/tests/desktop-auth.spec.ts` 验证密钥绑定、设备证明、授权和加密边界。
