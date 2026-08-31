---
description: "面向 DSH agent 的工作区隔离产品设计流程技能，用于调研、审计、构思、实现、验收和显式分享界面工作。"
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-product-design

[English](README.md) | 中文

## 概述

`dsh-skill-product-design` 把 Product Design 流程打包成十个 DSH skill：一个总路由，以及引导、上下文、调研、审计、视觉构思、图片转代码、网址转代码、设计 QA 和分享。把它挂载到 agent preset 后，只有选择该 preset 的会话会获得这套流程。随包的 `product-design` preset 把该技能包与标准工具和产品设计 persona 组合在一起。

技能包把持久上下文保存在当前工作区的 `product-design/` 下。它本身不授予任何工具，也不会假定浏览器截图或发布能力存在。随包产品设计 preset 现在会挂载提供方无关的图片生成工具，并通过本地 Dreamina CLI 固定使用图片 4.0 与 2K；其他组装仍可选择不同提供方。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

在 agent 作用域的组装中，于 skill 注册表之后挂载本技能包：

```yaml
- name: '@deepseek-ai/dsh-skill-product-design'
```

组装还必须暴露 `@deepseek-ai/dsh-tool-skill`，使模型可以发现并载入注册的正文。随包的产品设计 preset 已包含标准文件系统、shell、Web、交互和 skill Consumer，并挂载由 `@deepseek-ai/dsh-image-generation-dreamina` 支持的 `@deepseek-ai/dsh-tool-image-generation`；部署方仍可独立增加浏览器或发布工具。

### 流程目录

| Skill | 职责 |
|---|---|
| `product-design` | 把请求路由到最小且足够的流程 |
| `product-design-onboarding` | 创建或更新不含密钥的工作区本地设计上下文 |
| `product-design-context` | 读取保存的上下文并检查现有设计系统 |
| `product-design-research` | 把有来源的证据转化为设计决策 |
| `product-design-audit` | 生成按优先级排序的易用性、视觉、无障碍和实现问题 |
| `product-design-ideate` | 在实现前要求真正的视觉备选方案 |
| `product-design-image-to-code` | 在现有技术栈中实现选定截图或效果图 |
| `product-design-url-to-code` | 先捕获实时网址，再复刻所需前端 |
| `product-design-qa` | 验证核心旅程，并在同一状态比较参考与实现 |
| `product-design-share` | 只通过显式批准且实际可用的目标发布 |

十个 skill 均可由模型和用户调用，使用 `bundled` 来源标签和 `product-design` 提供方标签。同名的项目本地 skill 仍按 skill 注册表的正常优先级胜出。

### 工作区与租户行为

流程路径 `product-design/user-context.md` 相对于调用会话的当前工作区。DSH 已认证的工作区解析和文件系统策略仍然是读写权限来源；本技能包不保存进程全局用户资料、API key、Cookie 或可变状态。因此，不同 preset 或不同工作区的两个会话不会通过本包共享 skill 层或设计上下文文件。

### 能力行为

原 Product Design 流程依赖宿主提供浏览器截图、视觉生成和发布能力。DSH 版本仍对浏览器和发布要求采取失败即停止，而不是模拟能力。配置后，调研可使用标准 Web 工具；代码检查和实现可使用标准文件系统与 shell 工具。随包 preset 通过 Dreamina CLI 在工作区生成 PNG 视觉资源；同状态截图对比仍需要浏览器工具或用户提供的截图。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 注册

`apply` 通过 `ctx.skills.register()` 注册不可变的 `SkillRegistration` 记录。由于技能包挂载在 `product-design` 常驻 preset 作用域中，skill 注册表会把记录保存在该作用域层。名称校验、优先级、缓存、查找和 effect 释放均由注册表负责。

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | Cordis 插件入口与作用域注册循环 |
| [`src/skills.ts`](src/skills.ts) | 十个模型可见流程定义 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量配套入口；相关运行时关系由 skill 注册表负责 |
| [`tests/skill-product-design.spec.ts`](tests/skill-product-design.spec.ts) | 目录、护栏、作用域隔离和释放覆盖 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Skill 注册表](../skill/README.zh.md)——提供方优先级、作用域层、发现和调用策略。
- [Agent presets](../../preset/agent-presets/README.zh.md)——按会话组装与随包产品设计模式。
- [系统提示词子系统](../../../docs/subsystems/system-prompt.zh.md)——与这些 skill 组合的 persona 分区。

-----

<a id="model-experience"></a>
## 模型体验

### Product Design skill 目录

#### 模型看到什么

对加入挂载作用域的 agent，skill Consumer 会展示十条 `product-design` 名称摘要。载入某个 skill 时会返回完整流程正文，其中包含工作区上下文归属、来源要求、能力检查、验收规则和下一条流程路由。

#### Token 影响

条件式。Product Design agent 的每次请求都会包含十条简短的名称和描述；只有模型或用户载入某个 skill 时才加入完整正文。其他 preset 的 agent 不会收到本包条目。

#### KV Cache 影响

在 agent 生命周期内保持前缀稳定。技能包在 preset 发布 agent 前注册一次，且不可变定义不会在会话中改变。载入正文只会为该次调用追加请求上下文，不会改变其他 preset 的前缀。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **没有浏览器控制器**——技能包可以要求来源捕获和同状态对比，但部署未提供兼容浏览器工具且用户未提供截图时无法执行。
- **Dreamina 登录属于宿主本地状态**——生成要求 `dreamina` 位于 `PATH`（或设置 `DREAMINA_CLI_PATH`），且运行 DSH 的同一操作系统账号已经登录。
- **随包路线固定**——产品设计 preset 固定使用 Dreamina 图片 4.0 与 2K。能力 API 保持提供方无关，但首个提供方不会向 agent 开放模型或分辨率选择。
- **没有发布提供方**——分享需要已批准且已安装的目标；技能包不会仅因存在网络访问就通过 shell 命令发布。
- **仅保存项目本地上下文**——偏好不会自动跨无关项目跟随用户。这是为租户隔离而保留的设计，也避免引入第二套用户资料存储。

### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本包有意保持流程指令与浏览器捕获、图片生成及发布提供方分离。随包 preset 组合独立的 Dreamina 图片包，同时不让本技能目录依赖具体实现。

</details>
