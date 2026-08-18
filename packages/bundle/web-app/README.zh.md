# `@deepseek-ai/dsh-web-app`

[English](README.md) | 中文

dsh 浏览器表层组合包。[`cordis.patch.yml`](cordis.patch.yml) 叠加在 [`dsh-base`](../base/README.md) 之上：设置 coding persona，插入 Web 宿主行（webserver、API 网关、workspace、投影缓存、存储）、浏览器插件名录与始终挂载的客户端插件重载链（[`dsh-client-hmr`](../../client/hmr/README.md)，在重建 watcher 改写客户端 bundle 之前保持空闲），并挂载本包的 `web-runtime` 粘合插件（配置为 `{printUrl, surfaceContext, trustedHosts}`）。该插件通过 `@deepseek-ai/dsh-web-frontend` 的 exports 解析已构建的前端 dist，只采样一次依赖 bind 的 LAN 信任信息并将其作为 `webRuntime` 提供给浏览器信任栅栏和客户端名录，挂载 [`frontend-static`](../../host/frontend-static/README.md) 回退席位所有者，在 `surfaceContext` 为 true 时注册 Harness 源码与 Web 表层提示词段落，以及 bash 可见的 `DSH_WEB_URL` 运行时变量，并在 `printUrl` 为 true 时等自身的 Loader 配置树结算后再打印 `dsh web:` URL 行，避免兄弟行失败时公告一个已失效的应用。本组合包还持有应用命令行：普通 `web-startup` 提供方（[`src/startup.ts`](src/startup.ts)）等待 `ctx.cmdlineArgs`（[`dsh-cmdline`](../../boot/cmdline/README.md)）与 `ctx.auth`，解析 `--host`、`--port`、可重复的 `--trusted-host` 以及应用自己的 `--help`，再提供 `webStartup`。默认绑定仍为回环；显式传入 `--host 0.0.0.0` 会在所有网络接口上服务已认证用户，把本机 LAN IPv4 字面量推导进 Host/Origin 信任栅栏，并打印第一个 LAN URL。由 flag 配置的行会注入该服务，并在惰性配置中直接读取它，因此参数解析完成前不会有任何东西绑定端口，`dsh --profile web --help` 也不会启动服务器。[`dsh-headless`](../headless/README.md) 是同一 base 之上的同级表层，不挂载本组合包。

## 多用户服务运行

Web profile 是一个已认证、无协作功能的单进程服务。首次启动前应设置 `HARNESS_BOOTSTRAP_PASSWORD`；否则启动日志会打印生成的一次性管理员密码。当 TLS 直接终止在 Harness 时，使用 `HARNESS_SECURE_COOKIE=1` 启用 Cookie 的 `Secure` 属性。在加入部署适配器之前，OIDC 会在界面中明确显示为不可用。

认证文件与用户统一模型选择位于 `<DSH_HOME>/server/system/auth`，生成的用户目录位于 `<DSH_HOME>/server/users/<UserId>`。管理员统一 DeepSeek Key 使用现有 `<DSH_HOME>/.credentials.yaml` 存储，绝不会复制到用户目录。项目会在所属用户的数据树中创建，不提供服务器目录选择器。现有会话、workspace、附件与 storage 提供方继续保留原有文件格式，并按会话项目 cwd 授权。备份时应停止唯一的服务进程并复制完整 `DSH_HOME`；不得让多个服务进程共享同一认证根目录。

Web profile 把模型工具上限固定为 `workspace-write`，并向子进程隐藏完整 Harness home，只暴露已认证用户的数据树。Linux 服务主机需要 bubblewrap 提供该读取边界。当前 Landlock 与 Windows ACL 后端会关闭失败，不会在较弱的跨用户隔离下执行命令。

## 模型体验

### Harness 源码与 Web 表层上下文

#### 模型看到的内容

当 `surfaceContext` 为 true 时，`harness:source` 段落标明磁盘上的 Harness 实现，但不会声称它就是工作目录；全局段落 `app:web-surface`（顺序 −98）则向模型说明 GUI：规范的本地 URL、「this page」指代什么、更新约定（重载接收端始终开启；无刷新重载还需要 `pnpm run dev:web` watcher），以及不要启动替代服务器的指令。`DSH_WEB_URL` 还会连同描述出现在受管 bash 环境中，每次调用时从运行中的服务器解析。当它为 false 时，这两个段落和该变量都不会注册。

#### Token 影响

每个会话一行源码说明和一段提示词，外加两行受管环境变量；每个进程内保持恒定。

#### KV Cache 影响

该提示词段落位于系统提示词靠前位置，且在进程整个生命周期内稳定（端口是启动期事实），因此不会使跨轮次缓存失效。

## 已知限制与延期工作

- **前端 dist 必须已构建**：对 dist 的 `require.resolve` 在激活时明确报错并给出构建提示；没有从源码直接服务的回退路径。
- **`lanAddresses` 是启动期快照**：启动后的网卡变化不会重新公告；打印的 LAN URL 始终与配置的信任栅栏一致。
- **OIDC 尚未连接**：在提供 issuer、client、callback 和 claim 映射配置前，登录控件会报告暂缓状态。
