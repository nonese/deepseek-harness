# Agent Note: 面向 Product Design 的 Dreamina 图片生成

Status: implemented

[English](2026-08-31-dreamina-image-generation.md) | 中文

## 问题

Product Design preset 可以要求真实视觉备选方案，但 DSH 没有图片提供方。失败即停止的指引避免了伪造资源，却使用户必须离开 harness 才能生成源图片。宿主已经拥有已登录的 Dreamina CLI，请求路线是 Dreamina 图片 4.0 与 2K。

## 决策

增加完整的图片生成能力 seam：

- `dsh-image-generation` 负责有类型的提交、收集、pending、completed 与工作区发布词汇；
- `dsh-image-generation-dreamina` 负责托管 CLI 执行、固定 4.0/2K 提供方配置、任务解析、私有下载、校验、串行化与 PNG 原子发布；
- `dsh-tool-image-generation` 负责 `generate_image` 和 `collect_generated_image` schema、准确路线图片能力门、持久附件提交、模型渲染与纯 presentation。

在随包 Product Design preset 内，把提供方和 Consumer 挂载到一个 `imageGeneration` realm。该 preset 是常驻挂载，因此所有 Product Design 会话共享一个 Dreamina 队列；其他 preset 不会获得该服务或工具。`DREAMINA_CLI_PATH` 可以选择不在 PATH 的可执行文件，而无需通过配置传递登录材料。当宿主 glibc 无法执行该 CLI 时，可选 Docker-exec 路线会复用已经在本机运行且完成登录的容器内 CLI；三个设置分别指定容器，以及现有下载 bind mount 的宿主端和容器端。

## 安全属性

提供方会在提交前校验工作区目标，因此遍历、符号链接、冲突和无效扩展请求不会消耗点数。模型输入只通过 argv 数组进入 CLI。托管 subprocess 会清除形似凭据的环境变量、限制输出、传递取消，并负责进程树清理。发布前会校验提供方 JSON、状态、任务 ID、下载路径、文件种类、PNG 签名、大小和工作区包含关系。

下载使用私有随机平面目录。清理过程会取消链接常规或链接形态条目，并在不递归遍历的情况下删除目录。在 Docker 模式下，Dreamina 会收到对应的容器路径；提供方会在转换成宿主路径前，拒绝任何离开本次容器目录的返回路径。发布使用仅所有者可读写的随机临时文件，再通过硬链接创建或原子重命名完成。工具会先把提供方字节保存到附件服务，再发出持久图片 block；原始字节和提供方 URL 不会进入规范工具 JSON 或会话日志。

工具要求调用路线在提交前声明图片输入。纯文本路线不会先消耗点数，再因生成图片成为模型可见内容而失败。待完成任务返回不透明 ID，并且必须通过 `collect_generated_image` 恢复；流程明确禁止重复提交。

## 验证

提供方测试通过可执行 Dreamina fixture 使用真实本地 subprocess 实现，覆盖直接和 Docker-exec argv、完成下载/发布、容器到宿主的路径约束、pending 收集、提交前路径拒绝、提供方失败、非 PNG 拒绝、可执行文件不可用诊断和账号并发串行化。工具测试覆盖持久附件/图片 block 渲染、pending 行为、准确路线拒绝、缺少工作区和纯 presentation。无密钥录制会话回放还会实际执行 `generate_image`，验证完整 PNG 工作区状态并持久保存图片附件。只有在这些无密钥检查通过后，真实 CLI smoke 才会提交一张 4.0/2K 图片。

## 延后工作

参考图编辑、蒙版、批量、图片放大、视频、每位 DSH 用户点数额度、后台通知和专用 Web 卡片不属于本次变更。

## 考虑过的替代方案

**只通过 shell 指引调用 Dreamina。** 这种方案无需增加新的包组，但会失去有类型的参数校验、工作区安全发布、持久图片渲染、待完成任务恢复，以及扣费前的模型路线门。

**把 Dreamina 提供方直接公开为模型工具。** 这种方案会让 schema、生命周期和结果渲染与一个 CLI 耦合，使其他提供方无法实现同一个图片生成服务。

**允许共享宿主账号并发提交。** Dreamina CLI 使用同一个已登录账号、点数余额和任务命名空间。串行执行可以避免下载结果含糊，并让一个已挂载提供方以确定的顺序使用账号。

## 后果

- Product Design 会话可以直接在 DSH 内创建真实的 Dreamina 4.0 2K PNG，并恢复待完成任务。
- 生成文件保留在调用会话的工作区内，完成图片会持久保存为附件。
- 随包组合不会向其他 preset 提供图片生成工具或提供方访问权限。
- 在后续增加额度策略前，宿主 Dreamina 账号仍由所有用户共享、串行使用，并且不按 DSH 用户计量。
- 较旧宿主可以复用外部管理的本机 Dreamina 容器，无需替换系统 glibc；DSH 不负责该容器的生命周期或登录状态。
