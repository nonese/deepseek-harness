---
description: "Windows 桌面 profile 补丁：在 Web 界面上使用本地进程认证、DPAPI 凭据和完全访问默认值。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-desktop-app

[English](README.md) | 中文

## 概述

本补丁是 `desktop` profile 的最后一个内置层。它关闭多用户服务器认证，用保留 Connection 一次性进程 token 的回环提供方替换服务器启动提供方，把普通凭据文件替换为 Windows DPAPI 提供方，并让新会话默认使用 `danger-full-access` 与 `never` 审批。Electron 启动器仍然只在回环地址启动标准 `dsh --profile desktop` 应用；本组合包不是另一个应用入口。

发行的 profile 在本层之后加入 `dsh-browser-playwright@0.1.1`。Product Design 仍可使用，而首个 Windows 版本由启动器设置 `DSH_DISABLE_DREAMINA=1`。

## 目录

- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="model-experience"></a>
## 模型体验

通过桌面 profile 挂载的浏览器和 shell 使用方间接影响模型体验。

#### KV 缓存影响

静态工具 schema 会影响初始提示词前缀；本补丁不增加动态文本。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 完整文件系统访问是可信桌面场景的明确默认值，不适合不可信人员共用的 Windows 账号。
- 在打包并验收 Dreamina 的 Windows 运行时依赖前，图片生成保持关闭。

<a id="dev-note"></a>
### 开发备注

从已封装的 Windows 运行时执行 `dsh --profile desktop --dump-config` 可检查最终组合。Windows 构建工作流还会在封装前启动该运行时，并请求其通过进程 token 认证的页面。
