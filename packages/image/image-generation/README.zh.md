---
description: "供维护者组装或实现视觉提供方的提供方无关图片生成服务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-image-generation

[English](README.md) | 中文

## 概述

`dsh-image-generation` 定义 `ctx.imageGeneration`，用于提交一项图片任务、恢复待完成任务，并在一个可信工作区内发布完成的 PNG。Consumer 提供调用会话的绝对工作区根目录和模型编写的相对输出路径；提供方返回可恢复任务，或返回已经发布到该路径的已校验字节。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

部署需要其他提供方时实现 `ImageGenerationRuntime`。`generate()` 接收提示词、宽高比、输出路径和覆盖选择；`collect()` 接收相同的工作区事实及提供方任务 ID。两者都返回带不透明 ID 的 `pending`，或带提供方事实、PNG 字节、尺寸、字节数和工作区相对路径的 `completed`。

工作区根目录是同进程可信上下文。提示词、宽高比、输出路径、覆盖选择和任务 ID 都可能来自模型，因此提供方必须校验协议、把发布限制在工作区内、拒绝链接逃逸与静默替换、限制输出，并遵守取消信号。

-----

<a id="understand-the-implementation"></a>
## 理解实现

本包只包含请求/结果类型和抽象 Cordis 服务。提供方字节通过有类型的同进程调用交给工具 Consumer，使其在返回图片 block 前提交持久附件；服务不会把原始字节序列化进会话事件。

-----

<a id="further-exploration"></a>
## 进一步探索

- [Dreamina 提供方](../image-generation-dreamina/README.zh.md)——随包本地 CLI 实现。
- [面向模型的工具](../tool-image-generation/README.zh.md)——供 agent 使用的提交与收集 schema。
- [图片生成子系统](../../../docs/subsystems/image-generation.zh.md)——完整生命周期与归属。

-----

<a id="model-experience"></a>
## 模型体验

仅通过 `dsh-tool-image-generation` 等 Consumer 间接体现；Service Definition 自身不增加提示词分区或工具 schema。

#### KV Cache 影响

自身没有影响。注册工具或指引的 Consumer 负责相应请求前缀变化。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 第一版每项任务只生成一张光栅图片，并把工作区发布格式统一为 PNG。
- 参考图编辑、蒙版、图片放大与视频属于后续请求或独立能力方法。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
