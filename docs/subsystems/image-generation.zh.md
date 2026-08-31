---
description: "图片生成服务、Dreamina CLI 提供方、工作区发布及面向模型工具的生命周期。"
kind: "subsystem"
---

# 图片生成

[English](image-generation.md) | 中文

## 概要

图片生成是完整的能力 seam：`@deepseek-ai/dsh-image-generation` 定义 `ctx.imageGeneration`；`@deepseek-ai/dsh-image-generation-dreamina` 基于已登录的本地 Dreamina CLI 实现该服务；`@deepseek-ai/dsh-tool-image-generation` 暴露提供方无关的工具。随包 Product Design preset 在一个私有 realm 中挂载提供方和工具，固定使用 Dreamina 图片 4.0 与 2K。

## 请求生命周期

`generate_image` 会检查调用会话拥有工作区，并确认其准确 LLM 路线声明了图片输入。该检查发生在提供方提交前，因此任务不会先消耗点数，再留下路线无法接收的模型可见图片。工具把可信会话工作区、模型编写的提示词、宽高比、相对 PNG 路径和覆盖选择传给 `ctx.imageGeneration.generate()`。

Dreamina 提供方会在提交前校验输出目标，通过 `ctx.subprocess` 解析可执行文件，并把每段提示词和选项分别作为一个 argv 元素发送。`text2image` 固定使用 `--model_version=4.0` 与 `--resolution_type=2k`。完成的提交通过 `query_result --download_dir=<private-directory>` 查询，使 CLI 在同一操作系统登录下下载媒体。尚未完成的任务返回 `pending`；`collect_generated_image` 会查询该任务 ID，不会再提交一项计费操作。

## 发布与会话数据

提供方只接受受限大小的 JSON，校验不透明任务 ID 和状态，并从私有随机下载目录下读取一个常规 PNG。它先检查字节限制和 PNG 签名，再在真实会话工作区下原子发布仅所有者可读写的字节。相对路径不得隐藏、绝对、遍历，或经过符号链接父目录；替换已有文件必须明确请求覆盖。

工具通过 `ctx.attachments.saveImage()` 提交完成字节，并只把提供方事实、工作区元数据和持久附件引用作为规范 JSON 返回。渲染器生成由 `tool/result` 持久化的文本摘要和图片 block。原始字节、提供方 URL、私有临时路径、Dreamina 登录材料和凭据都不会进入事件日志。

## 并发与取消

一个提供方实例拥有一个 Promise 队列。Product Design preset 由使用该 preset 的所有会话共享一个常驻挂载，因此即使不同 DSH 用户同时提交，使用同一 Dreamina 账号的调用也不会重叠。该队列不实现每位用户的点数额度。

前台 subprocess 会收到工具取消信号。DSH subprocess 提供方会终止整个进程树并等待静止。Dreamina 提供方会分别报告 pending 状态、进程退出、信号终止、无效 JSON、提供方失败、校验失败和发布失败；它不会把这些结果折叠成成功生成。

## 配置

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `cliPath` | `dreamina` | 绝对可执行文件或 PATH 裸名称；preset 可读取 `DREAMINA_CLI_PATH` |
| `modelVersion` | `4.0` | 当前版本接受的固定提供方模型 |
| `resolution` | `2k` | 当前版本接受的固定提供方分辨率 |
| `pollSeconds` | `240` | 返回 pending 前的前台提交轮询时间 |
| `maxOutputBytes` | 25 MiB | 完整下载 PNG 的字节上限 |
| `maxPromptChars` | 20,000 | 提示词字符上限 |
| `graceMs` | 5,000 | 进程树终止宽限时间 |

## 已知限制

- 只组装文生图；没有开放 Dreamina 参考图、放大和视频路径。
- 未注册专用 Web 进度/图片卡片；通用工具行会渲染持久内容。
- Dreamina 登录与点数余额属于宿主操作系统账号，而不是单个 DSH 用户。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctximagegeneration--imagegenerationruntime-abstract-seam"></a>

### `ctx.imageGeneration` — `ImageGenerationRuntime` (abstract seam)

Image-generation service. Implementations validate provider output before publishing, confine `outputPath` below `cwd`, reject symbolic-link escapes, and serialize provider work when an account cannot safely process concurrent submissions.

```ts cordis-catalog
/**
 * Submit one image and wait for the provider's configured foreground interval.
 * @param request - trusted workspace root plus model-authored prompt, ratio, and output path.
 * @param signal - aborts provider work and publication.
 * @returns a completed workspace image or a resumable pending task.
 */
abstract generate(request: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult>

/**
 * Query and publish one previously submitted task.
 * @param request - trusted workspace root, prior task id, and output path.
 * @param signal - aborts provider work and publication.
 * @returns a completed workspace image or the still-pending task.
 */
abstract collect(request: ImageGenerationCollectRequest, signal?: AbortSignal): Promise<ImageGenerationResult>
```

Source: [`packages/image/image-generation/src/index.ts`](../../packages/image/image-generation/src/index.ts)
<!-- END GENERATED cordis-surface -->
