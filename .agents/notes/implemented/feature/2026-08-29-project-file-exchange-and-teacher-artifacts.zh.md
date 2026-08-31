# Agent Note: 项目文件交换与教师文档产物

Status: implemented

[English](2026-08-29-project-file-exchange-and-teacher-artifacts.md) | 中文

## 问题

多用户 Web 服务器把每个项目变成私有 workspace，并允许用户浏览和预览其中的文件，但浏览器无法通过明确的文件流程把源文件放入该 workspace，也无法下载生成结果。教师可以要求 agent 制作教案或课件，但随附的四种 preset 只有通用编码工具；生成可用的 Word、PowerPoint 或 Excel 文件依赖 shell 脚本、宿主上碰巧存在的 Office 库及模型自己编写的打包细节。直接导入 Codex 文档 skill 还会把服务器绑定到一个托管桌面运行时及其私有依赖路径，而不是形成可部署的 Harness 能力。

## 决定

已认证的项目文件界面是双向的。`PUT /auth/projects/:id/files/upload` 把一条原始请求体流式写入所选可见项目目录，现有下载路由则把一个普通文件流式传出。已认证用户的 workspace 解析、隐藏路径拒绝、路径越界拒绝与符号链接拒绝同样适用于上传、预览、列表和下载。上传有独立部署上限，使用私有临时文件并通过独占硬链接发布，因此同名竞争以 `FILE_CONFLICT` 失败；它绝不替换用户现有文件。Web 文件浏览器支持多选与文件拖放上传到当前目录，包括 Word、PowerPoint 与 Excel 文件，并保留现有的逐文件下载操作。项目列表保留文件对话框，运行时则把同一个浏览器挂载为可收起的文件面板，并根据当前 Session Workspace 派生项目。把非图片文件拖到会话主区域会将整批文件上传到该 Workspace 的根目录并刷新文件面板；仅含图片的拖放继续交给消息附件插件。

Office 创建是一套完整的能力 seam。`@deepseek-ai/dsh-artifacts` 定义 `ctx.documentArtifacts` 及提供方中立的 Word、演示文稿和电子表格请求。`@deepseek-ai/dsh-artifacts-local` 是所有用户共享的一个无状态宿主 Provider：每次调用接收受信的会话 workspace，在配置的项目/文本/单元格/输出限制下渲染，检查生成的 OOXML 压缩包，再原子发布到该 workspace 下。`@deepseek-ai/dsh-tool-artifacts` 拥有三个面向模型的 schema，并且只从调用 Agent 取得 `cwd`，因此模型不能选择另一名用户的根目录。

本地 Provider 使用 `docx`、PptxGenJS 与 ExcelJS，而不使用 Codex 托管运行时路径。其输出词汇有意小于这些创作 skill：带样式的 Word 章节与表格、四种附讲者备注的文本优先 PowerPoint 布局，以及含公式、格式、筛选和冻结表头的 Excel 工作表。Word 渲染器只在请求 Word 产物时导入 `docx`，因此 CLI 帮助和不生成 Word 的 profile 不会激活该依赖。JSZip 结构检查在发布任何目标前证明必要的 OOXML 系列部件存在。现有目标要求明确设置 `overwrite: true`，即使走覆盖路径，也会在重命名前再次检查符号链接和普通文件状态。

`teacher` 是第五个随附 agent preset。它复制完整标准组装，增加文档工具 Consumer，并把 persona 替换为教学指引，覆盖受众与目标、教学流程、评价证据、差异化支持、演示文稿备注与结构化教学数据。Web 宿主只挂载一次 Provider，而[按会话 preset 机制](../architecture/2026-08-03-per-session-agent-presets.zh.md)只向选择教师模式的会话授予工具和提示词。其他四种随附 preset 保持原有模型可见目录。

本决定应用既有的[能力 seam 拆分](../architecture/2026-06-13-capability-seams.zh.md)和按会话 preset 归属；它不取代任一记录。限定范围的审计未发现先前拥有浏览器文件上传或 Office 产物生成决定的活动 Agent Note。

## 考虑过的替代方案

**原样运行 Codex 的 Word、演示文稿和电子表格 skill。** 否决，因为这些 skill 面向 Codex 托管运行时及其捆绑依赖路径。长期运行的内网服务器需要普通的声明式包依赖及 workspace 权限明确的 Harness 服务。

**让教师 persona 通过 shell 命令创建 Office 文件。** 否决，因为库发现、路径安全、校验、结果类型和 UI 呈现会在模型编写的程序中反复实现。工具 schema 让这些义务在部署前可以强制执行和测试。

**为每名用户或每个 Agent 挂载一个文档生成器。** 否决，因为渲染器不携带用户状态。每次调用都显式接收受信 workspace 的单个宿主服务，可以在不随并发会话复制库实例的前提下保持租户隔离。

**在所有随附 preset 中暴露文档工具。** 否决，因为需求是教学工作流，向每个会话增加三个大型 schema 会提高固定请求前缀开销并改变无关 preset。按会话组装是这项选择既有的产品边界。

**把上传缓冲为 JSON/base64 或覆盖同名文件。** 否决，因为缓冲会让内存随文件大小及 base64 开销增长，而隐式覆盖会让普通浏览器操作具有破坏性。有界原始流与独占发布可以保持内存有界，并让冲突可恢复。

**只在项目列表对话框中提供项目文件。** 否决，因为用户必须离开活动会话才能检查或上传其中的 workspace 文件，而且先前打开的对话框不会跟随后续 Session 导航。运行时文件面板复用相同的已认证路由和浏览器组件，同时保留项目列表入口。

## 后果

- 用户可以从项目文件浏览器或会话主区域把源材料上传到当前私有项目，让教师模式会话在其中创建结构化 Office 文件，预览受支持的文本文件，并通过项目列表对话框或当前 Workspace 的运行时文件面板下载任意普通结果文件。
- 五十名已登录用户仍共享一个 Provider 和一个进程。只在文档调用期间工作；并发占用按活动调用而不是按账号产生生成内存。
- OOXML 结构校验能发现缺少的压缩包部件，但不能证明 Microsoft Office 或 LibreOffice 中的视觉质量。因此 v1 工具优先采用有界且确定的布局，不承诺任意文档编辑、图片密集型幻灯片、图表、动画或浏览器内 Office 渲染。
- Word、PowerPoint 与 Excel 生成库成为 Web bundle 的生产依赖；其版本和许可证声明必须通过仓库的供应链与第三方声明门禁。
- Provider 与工具测试会生成并重新打开全部三种格式；路径测试固定逃逸与覆盖行为；已认证路由测试固定角色隔离与上传限制；Web 文件场景验证文件浏览器与会话主区域上传并保留仅含图片的附件拖放；教师 preset 快照启动随附组装，并在没有外部模型调用的情况下创建三类文件。
