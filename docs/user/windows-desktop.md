# Windows desktop distribution

English | [中文](windows-desktop.zh.md)

The `奉中附小 DSH` desktop distribution is an unsigned Windows 10/11 x64 pilot. It contains Electron, Node.js 24, the built DSH Web client, the `desktop` profile, Product Design, and global `dsh-browser-playwright@0.1.1`. It does not require a separately installed Node.js runtime. macOS packaging, automatic updates, code signing, Dreamina on Windows, and Windows hardware acceptance are deferred.

## Build in GitHub Actions

Before running `.github/workflows/windows-desktop.yml`, an administrator must deploy the matching server changes and read the public signing JWK from `GET /auth/system/desktop/signing-key`. Configure these repository Actions variables in the user fork:

- `DSH_DESKTOP_SERVER_SIGNING_PUBLIC_JWK`: the complete public JWK JSON returned by the server; required.
- `DSH_DESKTOP_SERVER_ORIGIN`: the server origin; optional and defaults to `http://10.155.44.246:3081`.

Run the `Windows desktop installer` workflow manually. A `desktop-v*` tag runs the same build and publishes a GitHub Release. The workflow installs reviewed dependencies, builds the repository, runs the desktop protocol and server tests, stages a production runtime with workspace packages injected, verifies browser plugin version `0.1.1`, starts that staged runtime through the packaged Node executable, exchanges its one-time loopback URL for the Web page, materializes a separate dependency tree for the desktop package, and then asks Electron Forge to create `FZFX-DSH-Setup.exe`. The artifact also includes a SHA-256 file and a build manifest.

The pilot is not signed, so Windows SmartScreen may warn. Verify the SHA-256 value before installation. Do not describe a successful CI build as Windows runtime acceptance; startup, OIDC activation, DPAPI persistence, model synchronization, browser plugin launch, Office upload, and uninstall behavior still require the planned Windows hardware run.

## First launch and offline use

The first launch creates device keys under the signed-in Windows account and opens the system browser for the server's OIDC login. After activation, the desktop starts the packaged runtime only through `dsh --profile desktop`, authenticates the embedded Web view with that process's one-time loopback token, stores local credentials through Windows CurrentUser DPAPI, and displays the local Web application. Organization model sites are synchronized from the server; personal model keys remain local. DPAPI prevents another Windows account from reading the stored keys, but it cannot conceal a locally usable organization key from the authorized account that runs DSH.

The signed device lease lasts 30 days by default. The desktop synchronizes when online and attempts renewal in the final seven days. A server outage does not interrupt a still-valid offline lease. Expiry requires a new successful server authorization, and administrator revocation takes effect when the device next contacts the server or its existing lease expires.

## Local construction checks

macOS and Linux can validate source construction but cannot produce the final Squirrel installer:

```sh
pnpm run build:desktop
pnpm exec vitest run apps/desktop/tests/runtime.spec.ts packages/boot/app-boot/tests/profile.spec.ts packages/bundle/desktop-app/tests/startup.spec.ts packages/credentials/credentials-windows/tests/credentials-windows.spec.ts packages/identity/desktop-auth/tests/desktop-auth.spec.ts packages/identity/auth-file/tests/auth-file.spec.ts packages/host/auth-web/tests/auth-web.spec.ts
```

Installer assembly is intentionally owned by the Windows GitHub Actions runner.
