# Agent Note: Windows 桌面运行时与设备授权

Status: implemented

[English](2026-09-01-windows-desktop-runtime.md) | 中文

## 问题

内网 Web 部署已经为每位认证用户提供隔离的服务器工作区，但教职工还需要一个完整的 Windows 应用，无需安装 Node.js 或管理每用户容器即可在本机运行 Harness。只包含浏览器的外壳无法保留本地项目，也不能在服务器临时中断时继续使用。若把管理员管理的 API Key 复制进安装包文件、进程环境或可复用浏览器令牌，一台设备泄露就会暴露长期有效的组织凭据。

## 决策

`apps/desktop` 打包 Electron 外壳、Node.js 24，以及普通 `dsh --profile desktop` 应用的生产依赖闭包。外壳负责设备激活、授权续期、加密组织配置安装和子进程生命周期；它不会直接挂载 Cordis，也不会暴露另一个应用入口。首个试运行版本面向 Windows 10/11 x64。本次发行不包含 macOS 打包、自动更新、代码签名、Windows Dreamina 集成和 Windows 实机验收。

## 发行与启动

`desktop` profile 组合普通 base 和 Web bundle，再应用 `@deepseek-ai/dsh-desktop-app`，获得 CurrentUser DPAPI 凭据、单进程回环认证和完全本地权限默认值。它包含 Product Design，并把 `dsh-browser-playwright@0.1.1` 固定为进程全局 profile bundle。桌面层用仅限回环的提供方替换服务器 Web 启动提供方，该提供方不等待多用户认证服务；普通 Connection 进程 token 只允许已启动的嵌入式 Web 视图进入。现有 Dreamina CLI 未针对 Windows 打包，因此启动器设置 `DSH_DISABLE_DREAMINA=1`；启动器只使用随附 `node.exe` 运行暂存的 `lib/bin.js --profile desktop`。

`.github/workflows/windows-desktop.yml` 在用户自己的 fork 中使用 Windows x64 runner 构建。CLI 应用 manifest 显式声明其生产包闭包能够到达的所有运行时 peer provider；模块回退遍历会先沿每个 pnpm 链接进入包的物理目录，再解析其隔离依赖。工作流把已构建 workspace 包注入 hoisted 生产运行时，验证浏览器插件版本，通过复制的 `node.exe` 启动暂存运行时，并请求其已认证回环地址对应的页面。第二次 hoisted deploy 会在短暂存目录中实体化桌面包及其开发依赖，使 Electron Forge 遍历实际依赖目录而不是 workspace 链接。两棵依赖树都采用 hoisted 布局还能避免 pnpm 虚拟存储路径超过 Squirrel 的 NuGet 打包器所执行的路径限制。两次 deploy 都会跳过依赖安装脚本，因此打包脚本会在调用 Squirrel 前选择 electron-winstaller 的 x64 版 7-Zip 可执行文件和动态库。Forge 生成未签名的 Squirrel `FZFX-DSH-Setup.exe`，工作流同时发布校验和与构建清单。手动触发会上传 artifact；`desktop-v*` 标签还可以创建 GitHub Release。安装包通过仓库 Actions 变量固定服务器 origin 与服务器公开签名 JWK；这两项都不是秘密。

## 设备授权

设备首次激活时生成 Ed25519 签名密钥对和 X25519 加密密钥对。服务器在系统浏览器中运行现有 Authorization Code with PKCE OIDC 流程，把验证后的身份绑定到设备公钥，并要求 Ed25519 证明后才释放结果。结果包含服务器签名的 30 天设备授权和使用 X25519 加密的组织配置。私钥与已接受状态由 Electron `safeStorage` 按当前登录的 Windows 账号加密。

每次设备授权续期与配置同步请求都携带签名授权和新的设备证明。服务器在现有基于文件的认证存储中记录公开设备数据与撤销状态。客户端在最后 7 天内开始续期。未过期授权允许离线启动；过期后默认拒绝。撤销会阻止后续续期与同步，但服务器无法在离线设备的签名授权到期前主动收回它。

## 凭据与模型同步

`@deepseek-ai/dsh-credentials-windows` 保存一份受 Windows CurrentUser DPAPI 保护的版本化凭据文档，通过原子替换写入且不创建明文暂存文件。组织模型 Key 只存在于该设备的加密配置中，并占用保留的 `desktop-org-*` 引用与模型路由。后续同步会替换这组保留项，同时保留个人凭据引用与记录。Web UI 不显示组织 Key，其他 Windows 账号也无法解密该文件；但控制已授权 Windows 账号及其进程的用户仍可提取本地使用的 Key。因此管理员必须把每台已激活设备视为 Key 持有者，并在设备失陷后轮换组织凭据。

服务器签名私有 JWK 和管理员管理的模型 Key 仍保存在服务器 credentials 提供方中。安装包只包含签名公开 JWK。服务器提供仅管理员可用的公开密钥、设备列表和撤销路由；这些路由永远不会返回私有签名密钥或组织原始 Key。

## 考虑过的替代方案

**只包含浏览器的 Electron 外壳。** 这样能减小安装包，但无法离线运行本地项目，并且只是重复服务器客户端，不能提供所需的完整桌面应用。

**每位桌面用户一个服务器容器。** 这样保留进程隔离，但会重新引入单进程多用户服务器原本要避免的启动延迟与运维成本，而且不能提供 Windows 本地项目执行。

**在 Electron 中直接挂载 Cordis。** 这样会创建第二条应用启动路径，并绕过受支持的 `dsh` profile 生命周期。启动普通的打包后 CLI 可以只保留一套启动约定。

**通过环境变量或安装包配置分发共享 Key。** 这些值可被提取，也无法随同步配置单独轮换。设备绑定加密与 DPAPI 可以让原始 Key 不进入 GitHub 变量、安装包元数据和磁盘明文文件。

**把浏览器会话 Cookie 复用为桌面授权。** 浏览器 Cookie 是依赖在线撤销的会话，不能表示设备持有证明或有界离线权限。签名设备授权明确规定了离线时长。

## 后果

试运行版本能生成自包含 Windows 安装包，并让本地 Harness 架构继续使用受支持的 profile 入口。它复用服务器 OIDC 身份，保留服务器基于文件的存储方式，为管理员提供有界设备撤销，并在静态存储中分离组织模型凭据和个人模型凭据。

安装包比 WebView 外壳更大，并且因为未签名可能触发 Windows SmartScreen。已撤销的离线设备仍可使用到当前授权到期。DPAPI 保护静态凭据，但无法对已授权 Windows 账号隐藏本机可用的 Key。GitHub Actions 必须先取得已部署服务器的公开签名 JWK，才能构建可用安装包。CI 构建可证明暂存的 Windows 运行时能够加载完整桌面 profile、初始化 DPAPI 凭据，并提供通过进程 token 认证的页面。它不能证明实机验收已经完成；安装、OIDC 激活、跨 Windows 登录持久化、浏览器自动化、Office 上传、模型使用、离线行为、升级和卸载，都要等暂缓的 Windows 实机测试后才能确认。
