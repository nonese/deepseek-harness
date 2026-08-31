---
description: "固定使用图片 4.0 与 2K、在工作区生成 PNG 的本地 Dreamina CLI 提供方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-image-generation-dreamina

[English](README.md) | 中文

## 概述

`dsh-image-generation-dreamina` 通过 DSH 托管 subprocess 服务调用已登录的本地 `dreamina` CLI，实现 `ctx.imageGeneration`。它提交 `text2image`，固定模型 `4.0` 与分辨率 `2k`，在前台轮询，通过 `query_result` 恢复未完成任务，校验下载的 PNG，并在调用会话工作区内原子发布。

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

把提供方与 Consumer 挂载在同一服务 realm：

```yaml
- name: '@deepseek-ai/dsh-image-generation-dreamina'
  config:
    cliPath: !!js process.env.DREAMINA_CLI_PATH
    modelVersion: '4.0'
    resolution: 2k
    pollSeconds: 240
```

请使用完成过 `dreamina login` 的同一操作系统账号运行 DSH。`cliPath` 可填写绝对可执行文件或 PATH 中的裸名称，默认是 `dreamina`。提供方配置不会接收 Dreamina 密码、Cookie、API key 或登录响应。

当宿主的 glibc 无法运行 CLI 时，提供方可以调用已经在本机 Docker 容器中登录的 Dreamina CLI。宿主和容器下载根目录必须是同一个 bind mount 的两侧：

```yaml
- name: '@deepseek-ai/dsh-image-generation-dreamina'
  config:
    cliPath: dreamina
    dockerContainer: dreamina-mcp
    dockerHostDownloadRoot: /srv/dreamina/runtime
    dockerContainerDownloadRoot: /data
    dockerPath: /usr/bin/docker
```

Docker 模式通过 argv 数组调用 `docker exec`，不会创建、重启或重新配置容器。运行 DSH 的操作系统账号必须已经拥有 Docker 执行权限，指定容器也必须已经在运行。

-----

<a id="understand-the-implementation"></a>
## 理解实现

每个模型值都成为独立 argv 元素，不经过 shell 解析提示词。DSH subprocess 会清除环境中形似凭据的变量，并负责进程树取消。提供方限制 stdout/stderr，只接受 JSON，校验任务 ID 与状态，把结果下载到私有随机目录，拒绝链接形态、非 PNG 或过大输出，并在不递归跟随链接的前提下删除临时条目。Docker 模式还会先确认容器返回的路径位于本次随机 bind-mounted 目录内，再把它转换为宿主路径。

提交前，提供方会在真实工作区根目录下解析输出，拒绝隐藏、遍历、符号链接和冲突目标。完成字节通过仅所有者可读写的临时文件原子发布。一个 Promise 队列会串行处理该挂载 Dreamina 账号的提交与收集操作。

-----

<a id="further-exploration"></a>
## 进一步探索

- [Service Definition](../image-generation/README.zh.md)——提供方无关请求与结果。
- [面向模型的工具](../tool-image-generation/README.zh.md)——工作区和持久附件投影。
- [防御模式](../../../docs/defensive-patterns.zh.md)——subprocess 与路径清理规则。

-----

<a id="model-experience"></a>
## 模型体验

### 提供方结果

#### 模型所见内容

提供方自身不增加 schema。`dsh-tool-image-generation` 调用它时，完成结果会展示提供方名称、模型 `4.0`、分辨率 `2k`、尺寸和工作区相对 PNG 路径；待完成结果会展示用于收集的不透明任务 ID。

#### Token 影响

没有固定的请求前缀成本。只有提交或收集工具被调用后，提供方事实才会通过工具结果进入上下文。

#### KV Cache 影响

提供方配置不在稳定请求前缀中。完成后，每次调用的结果元数据和生成图片内容会扩展会话历史，因此会影响该位置之后的复用。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 只开放 `text2image`；Dreamina 参考图模式和视频命令不属于当前提供方版本。
- 提供方共用宿主账号的 Dreamina 登录和点数。单队列会防止重叠，但不分配每位 DSH 用户的额度。
- Docker 模式依赖外部管理且已经运行的容器，以及正确配对的 bind mount；提供方不管理该容器的生命周期。
- 待完成任务需要 Consumer 稍后调用 `collect()`；提供方不会创建后台任务或通知。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

随包 Product Design preset 负责首个组装。模型/版本默认值应明确存在于该 preset 和提供方配置中，而不是硬编码进工具 Consumer。

</details>
