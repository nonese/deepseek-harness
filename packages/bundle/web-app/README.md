# `@deepseek-ai/dsh-web-app`

English | [中文](README.zh.md)

The dsh browser-surface bundle. [`cordis.patch.yml`](cordis.patch.yml) rides over [`dsh-base`](../base/README.md): it sets the coding persona, inserts the Web host rows (webserver, API gateway, workspace, projection cache, storage) and the browser plugin roster, the always-on client-plugin reload chain ([`dsh-client-hmr`](../../client/hmr/README.md), idle until a rebuild watcher rewrites client bundles), and mounts this package's `web-runtime` glue plugin (config `{printUrl, surfaceContext, trustedHosts}`). That plugin resolves the built frontend dist through `@deepseek-ai/dsh-web-frontend`'s exports, samples bind-dependent LAN trust once, provides it as `webRuntime` to the browser-trust fence and client roster, mounts the [`frontend-static`](../../host/frontend-static/README.md) fallback owner, registers the harness-source and web-surface prompt sections plus the bash-visible `DSH_WEB_URL` runtime variable when `surfaceContext` is true, and prints the `dsh web:` URL line when `printUrl` is true, after its Loader tree settles so a sibling failure cannot announce a dead app. This bundle also owns the app command line: the ordinary `web-startup` provider ([`src/startup.ts`](src/startup.ts)) waits for `ctx.cmdlineArgs` ([`dsh-cmdline`](../../boot/cmdline/README.md)) and `ctx.auth`, parses `--host`, `--port`, repeatable `--trusted-host`, and the app's `--help`, then provides `webStartup`. The default bind remains loopback; an explicit `--host 0.0.0.0` serves authenticated users on every interface, derives the machine's LAN IPv4 literals into the Host/Origin trust fence, and prints the first LAN URL. Flag-configured rows inject the service and read it directly from lazy config, so nothing binds a port before argument resolution and `dsh --profile web --help` starts no server. [`dsh-headless`](../headless/README.md) is a sibling surface over the same base and does not mount this bundle.

## Multi-user server operation

The Web profile is one authenticated, non-collaborative server process. Set `HARNESS_BOOTSTRAP_PASSWORD` before the first start; otherwise the startup log prints a generated one-time administrator password. `HARNESS_SECURE_COOKIE=1` enables the `Secure` cookie attribute when TLS terminates at Harness. OIDC remains visibly unavailable until a deployment adapter is added.

Authentication files and per-user managed-model choices live under `<DSH_HOME>/server/system/auth`; generated user trees live under `<DSH_HOME>/server/users/<UserId>`. The administrator-managed DeepSeek key uses the existing `<DSH_HOME>/.credentials.yaml` store and is never copied into user trees. Projects are created below the owning user's tree without a server directory picker. Existing session, workspace, attachment, and storage providers retain their file formats and are authorized by the session's project cwd. Back up the complete `DSH_HOME` while the single server process is stopped; do not point multiple server processes at one auth root.

The Web profile caps model tools at `workspace-write` and hides the complete Harness home from child processes except for the authenticated user's tree. Linux service hosts require bubblewrap for that read boundary. The current Landlock and Windows ACL backends fail closed instead of running a command with weaker cross-user isolation.

## Model Experience

### Harness-source and Web-surface context

#### What the model sees

When `surfaceContext` is true, the `harness:source` section identifies the on-disk Harness implementation without claiming it is the working directory, and the `app:web-surface` global section (order −98) orients the model to the GUI: the canonical local URL, the "this page" referent, the update contract (the reload receiver is always on; no-refresh reloads additionally need the `pnpm run dev:web` watcher), and the instruction not to start replacement servers. `DSH_WEB_URL` additionally appears in the managed bash environment with its description, resolved per invocation from the live server. When it is false, neither section nor the variable is registered.

#### Token effect

One source line and one prompt paragraph per session plus two managed-environment variable lines; constant per process.

#### KV Cache effect

The prompt section sits near the system prompt's head and is stable for the life of the process (the port is a boot fact), so it does not invalidate the cache across turns.

## Known Limitations and Deferred Work

- **The frontend dist must be built** — `require.resolve` of the dist fails loud at activation with a build hint; there is no source-serving fallback.
- **`lanAddresses` is a boot-time snapshot** — interface changes after boot are not re-advertised; the printed LAN URL always matches the configured trust fence.
- **OIDC is not connected** — the login control reports the deferred state until issuer, client, callback, and claim-mapping configuration is supplied.
