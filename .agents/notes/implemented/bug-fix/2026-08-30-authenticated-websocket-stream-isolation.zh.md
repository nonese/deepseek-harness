# Agent Note：已认证 WebSocket 流隔离

状态：已实现

[English](2026-08-30-authenticated-websocket-stream-isolation.md) | 中文

## 问题

多用户 Web 部署会认证 `/api/remote.mux` 的 HTTP 升级请求，但随后由 WebSocket 消息回调打开逻辑 Remote 流时，没有恢复该请求的用户身份。Auth Web Gateway 中间件把缺少身份的情况当成未认证的内部调用，并继续读取进程级数据源。因此，即使已有投影器在身份存在时能正确过滤数据，浏览器仍可能收到其他用户的 Workspace、Session 控制状态和进程事件。

## 决策

每条已接受的多路复用 WebSocket 都保留自己的 `ConnectionRequestAuthorization`。每个逻辑流 pump 都通过该授权对象的 `run()` 方法开始，因此授权中间件、流创建和异步迭代都在这条 Socket 捕获的用户身份下执行。通用 Gateway 仍支持无用户身份的部署，因为默认进程令牌 Connection 授权提供恒等 runner。

Auth Web Gateway 中间件现在会拒绝没有当前用户身份的一元和流式分发。该中间件只由 Auth Web 部署组件安装，因此缺少身份表示传输或集成故障，而不是受支持的内部调用。Workspace、Session 控制和事件数据源仍为进程级；已有 Auth Web 投影器继续作为统一所有权层，并在每条浏览器流上获得稳定身份。

事件 waterfall 投影也参与 Gateway 的投递记账。投影器抑制其他用户的 waterfall 时，会立即委托该 Client 的投递；可见所有者响应后 Host continuation 即可结算，后续取消也只会发送给实际收到 waterfall 的 Client。

## 考虑过的替代方案

**只过滤 `workspace/follow`。** 不采用，因为 `session/control`、`$events/follow` 和任何按 Session 定位的流仍会保留相同的缺失身份绕过。

**依赖 HTTP 升级时使用的执行上下文。** 不采用，因为后续 WebSocket 消息回调是独立的异步入口，不会自动继承那次调用的上下文。

**在浏览器中过滤其他用户的条目。** 不采用，因为私有路径和 Session 状态在过滤前已经越过服务端授权边界。

## 后果

- 一个进程仍可服务多个用户，同时每条 WebSocket 连接只投影其已认证用户的 Workspace、Session 和事件。
- 未来如果传输层再次丢失身份，会关闭访问而不是暴露进程级 Remote 数据。
- 被过滤的其他用户 waterfall 不会阻塞其所有者的 continuation，也不会通过后续取消暴露事件 ID。
- 注销或停用账号目前不会立即撤销已经接受的 Socket；会话过期与重连行为属于独立的生命周期策略。
- 载体测试固定异步迭代与取消期间的按 Socket 执行上下文。真实 mux 覆盖证明其他用户的 Client 既收不到 waterfall 也收不到其取消，同时所有者的 `next()` 可结算 Host continuation；多用户验收覆盖独立项目、文件路由和并发 Session。
