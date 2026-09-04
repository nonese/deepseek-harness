# 奉中附小 DSH Windows 桌面版

[English](README.md) | 中文

Electron 外壳打包完整的 Windows x64 DSH 运行时，并只通过 `dsh --profile desktop` 启动受支持的 Node 应用。首次启动使用系统浏览器完成服务器现有的 OIDC 流程。服务器签署的 30 天设备授权允许离线使用；客户端在最后 7 天内续期，并在联网时同步管理员管理的模型站点。设备私钥和缓存激活状态使用 Electron `safeStorage`，模型 API Key 使用 DPAPI 凭据提供方。

一个 ESM 启动入口只使用 Node 内置模块处理 Squirrel 的安装、更新、卸载和旧进程事件，然后才按需动态导入 Electron 应用。桌面构建会把 Electron 之外的所有 JavaScript 依赖嵌入该主模块，因此安装后的外壳不需要从 `resources/app` 解析 Harness workspace 包。外壳会禁用硬件加速，只显示激活状态而不自动启动 DSH，并且只有用户选择“启动本地 DSH”后才拉起本地运行时。通过 `FZFX-DSH.exe --safe-mode` 启动时，外壳不会连接服务器，也不会启动运行时。经过凭据脱敏且大小受限的启动诊断记录在 Electron 用户数据目录下的 `logs/desktop-startup.jsonl`。

`windows-desktop.yml` 构建未签名的试运行安装包。仓库 Actions 变量必须提供 `DSH_DESKTOP_SERVER_SIGNING_PUBLIC_JWK`；`DSH_DESKTOP_SERVER_ORIGIN` 默认是 `http://10.155.44.246:3081`。工作流会先生成桌面主模块，再运行需要检查该文件的构造测试。封装前，Windows runner 会启动暂存运行时，并请求其通过进程 token 认证的页面。它在短暂存路径中为运行时和 Electron Forge 生成 hoisted 实体依赖树，不直接打包 pnpm workspace 或虚拟存储链接，同时让 Squirrel 的 NuGet 输入保持在 Windows 路径限制内。因为这些隔离依赖树会跳过依赖安装脚本，打包脚本会在调用 Squirrel 前显式选择 electron-winstaller 的 x64 版 7-Zip 可执行文件和动态库。封装后，runner 会要求 Squirrel 旧进程事件和正常 Electron 主模块导入都在 15 秒内成功退出；第二项探测不会启动应用生命周期，但能在上传产物前发现打包依赖无法解析的问题。产物包含 `FZFX-DSH-Setup.exe`、它的 SHA-256 文件和构建清单。在完成 Windows 实机验收前，不能把该试运行版本描述为生产就绪。

## 本地构建检查

Windows 安装器版本取自本目录的 [package.json](package.json)，独立于内置 DSH 运行时版本。分发内容有变化的安装包前必须递增该版本，让 Squirrel 能区分已安装的包和替换包。

```sh
pnpm run build:desktop
pnpm exec vitest run apps/desktop/tests/runtime.spec.ts
```

安装包本身只在 Windows 上由 `.github/scripts/build-windows-desktop.ps1` 组装；执行前仓库构建必须已经生成所有运行时包和 Web 资源。
