# Windows 桌面发行版

[English](windows-desktop.md) | 中文

`奉中附小 DSH` 桌面发行版是面向 Windows 10/11 x64 的未签名试运行版本。它完整包含 Electron、Node.js 24、构建后的 DSH Web 客户端、`desktop` profile、Product Design 和全局 `dsh-browser-playwright@0.1.1`，不要求另行安装 Node.js。macOS 打包、自动更新、代码签名、Windows 上的 Dreamina 和 Windows 实机验收暂缓。

## 使用 GitHub Actions 构建

运行 `.github/workflows/windows-desktop.yml` 前，管理员必须先部署与客户端匹配的服务器改动，再从 `GET /auth/system/desktop/signing-key` 读取公开签名 JWK。请在用户自己的 fork 中配置下列仓库 Actions 变量：

- `DSH_DESKTOP_SERVER_SIGNING_PUBLIC_JWK`：服务器返回的完整公开 JWK JSON，必填。
- `DSH_DESKTOP_SERVER_ORIGIN`：服务器 origin，可选；默认是 `http://10.155.44.246:3081`。

手动运行 `Windows desktop installer` 工作流即可构建。推送 `desktop-v*` 标签会执行相同构建并发布 GitHub Release。工作流会安装已审核依赖、构建仓库、运行桌面协议与服务器测试、注入 workspace 包并暂存生产运行时、验证浏览器插件版本为 `0.1.1`，再通过随附 Node 可执行文件启动该暂存运行时，用其一次性回环地址换取 Web 页面，最后由 Electron Forge 生成 `FZFX-DSH-Setup.exe`。产物还包含 SHA-256 文件和构建清单。

试运行版本尚未签名，因此 Windows SmartScreen 可能发出警告。安装前应校验 SHA-256。CI 构建成功不能作为 Windows 运行验收结论；启动、OIDC 激活、DPAPI 持久化、模型同步、浏览器插件启动、Office 文件上传和卸载行为仍须按计划执行 Windows 实机验证。

## 首次启动与离线使用

首次启动会在当前 Windows 账号下生成设备密钥，并使用系统浏览器打开服务器 OIDC 登录。激活后，桌面程序只通过 `dsh --profile desktop` 启动随附运行时，使用该进程的一次性回环 token 认证嵌入式 Web 视图，使用 Windows CurrentUser DPAPI 保存本地凭据，并显示本地 Web 应用。组织模型站点从服务器同步；个人模型 Key 只保留在本机。DPAPI 能防止其他 Windows 账号读取已存储的 Key，但无法向实际运行 DSH 的已授权账号隐藏本机可用的组织 Key。

签名设备授权默认有效 30 天。桌面程序联网时同步，并在最后 7 天内尝试续期。服务器临时不可用不会中断仍然有效的离线授权。授权过期后必须重新成功连接服务器；管理员撤销会在设备下次连接服务器或现有授权到期时生效。

## 本地构建检查

macOS 和 Linux 可以验证源码构建，但不能生成最终 Squirrel 安装包：

```sh
pnpm run build:desktop
pnpm exec vitest run apps/desktop/tests/runtime.spec.ts packages/boot/app-boot/tests/profile.spec.ts packages/bundle/desktop-app/tests/startup.spec.ts packages/credentials/credentials-windows/tests/credentials-windows.spec.ts packages/identity/desktop-auth/tests/desktop-auth.spec.ts packages/identity/auth-file/tests/auth-file.spec.ts packages/host/auth-web/tests/auth-web.spec.ts
```

安装包组装明确由 Windows GitHub Actions runner 负责。
