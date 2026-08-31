---
description: "供 DSH 桌面打包运行时使用的 Windows CurrentUser DPAPI 凭据提供方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-credentials-windows

[English](README.md) | 中文

## 概述

本提供方把完整的凭据引用与凭据记录文档保存为一个 CurrentUser DPAPI 密文。明文只通过标准输入交给非交互式 PowerShell DPAPI 辅助进程，不进入环境变量或命令参数，原子替换时也只写入加密字节。桌面启动器在 DSH 停止期间调用 `replaceWindowsCredentialRefs` 对齐自己拥有的单位凭据命名空间，不会删除个人凭据。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Windows `desktop` profile 中把它挂载为 `credentials` 行。默认文件为 `<DSH_HOME>/credentials.dpapi`。只有同一个 Windows 账号能够解密；把文件复制到另一个用户配置文件不会转移密钥。

<a id="model-experience"></a>
## 模型体验

通过 `ctx.credentials` 的使用方间接影响模型体验；任何面向模型的行为由使用方负责。

#### KV 缓存影响

无。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 本提供方只支持 Windows，并依赖 Windows PowerShell 和 CurrentUser DPAPI。
- 一个桌面进程独占文档，因此有意不提供实时文件监听。

<a id="dev-note"></a>
### 开发备注

测试可以注入保护器，使非 Windows CI 能验证持久格式、原子更新和明文不落盘，但这不代表完成了 Windows DPAPI 实机验收。
