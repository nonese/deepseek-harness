# Agent Note: Windows desktop runtime and device authorization

Status: implemented

English | [中文](2026-09-01-windows-desktop-runtime.zh.md)

## Problem

The intranet Web deployment gives each authenticated user an isolated server workspace, but staff also need a complete Windows application that can run the Harness locally without installing Node.js or managing a per-user container. A browser-only shell does not preserve local projects or remain usable during a temporary server outage. Copying administrator-managed API keys into installer files, process environments, or reusable browser tokens would make one leaked device a long-lived organization credential.

## Decision

`apps/desktop` packages an Electron shell, Node.js 24, and the production dependency closure for the normal `dsh --profile desktop` application. The shell owns device activation, lease renewal, encrypted organization configuration installation, and the child-process lifecycle; it does not mount Cordis directly or expose another application entrypoint. The first pilot targets Windows 10/11 x64. macOS packaging, automatic updates, code signing, Windows Dreamina integration, and Windows hardware acceptance are absent from this release.

## Distribution and launch

The `desktop` profile composes the ordinary base and Web bundles, then applies `@deepseek-ai/dsh-desktop-app` for CurrentUser DPAPI credentials, single-process loopback authentication, and full local permission defaults. It includes Product Design and pins `dsh-browser-playwright@0.1.1` as a process-global profile bundle. The desktop layer replaces the server Web startup provider with a loopback-only provider that does not wait for a multi-user authentication service; the ordinary Connection process token admits only the launched embedded Web view. The launcher sets `DSH_DISABLE_DREAMINA=1` because the existing Dreamina CLI is not packaged for Windows, and it starts only the staged `lib/bin.js --profile desktop` through the packaged `node.exe`. The package main is an ESM bootstrap that imports only Node built-ins, recognizes Squirrel lifecycle arguments after the executable even when an application argument is present, and exits without importing Electron or desktop dependencies. Install, update, uninstall, and obsolete-process invocations therefore cannot start the bundled runtime or wait for Electron initialization. A normal invocation dynamically imports the Electron main module, which disables hardware acceleration and requires the user to select the local-runtime action after activation or authorization refresh; `--safe-mode` loads only the shell and skips server and runtime startup. The shell writes bounded, credential-redacted startup and child-process events below Electron's user-data directory and uses Windows tree-scoped termination while awaiting DSH shutdown.

`.github/workflows/windows-desktop.yml` builds on a Windows x64 runner in the user fork. The CLI application manifest declares every runtime peer provider reached through its production package closure; the module-fallback traversal follows each pnpm link to the physical package directory before resolving its isolated dependencies. The workflow injects the built workspace packages into a hoisted production runtime, verifies the browser plugin version, starts the staged runtime through its copied `node.exe`, and requests the page through its authenticated loopback URL. A second hoisted deploy materializes the desktop package and its development dependencies in a short staging directory so Electron Forge traverses concrete dependency directories instead of workspace links. Hoisting both trees also prevents pnpm virtual-store paths from exceeding the path limit enforced by Squirrel's NuGet packer. Both deploys skip dependency install scripts; the packaging script therefore selects electron-winstaller's x64 7-Zip executable and library before invoking Squirrel. Forge creates an unsigned Squirrel `FZFX-DSH-Setup.exe`; the Windows runner then invokes the packaged executable with Squirrel's obsolete-process argument and rejects a nonzero exit or a run longer than fifteen seconds. The workflow publishes the installer with a checksum and build manifest. Manual dispatch uploads an artifact; a `desktop-v*` tag may also create a GitHub Release. The installer pins a server origin and the server's public signing JWK from repository Actions variables. Neither value is a secret.

## Device authorization

The device generates Ed25519 signing and X25519 encryption key pairs on first activation. The server runs its existing Authorization Code with PKCE OIDC flow in the system browser, binds the verified identity to the device public keys, and requires an Ed25519 proof before releasing the result. The result contains a server-signed 30-day lease and an X25519-encrypted organization configuration. The private keys and accepted state are encrypted by Electron `safeStorage` for the signed-in Windows account.

Every lease-renewal and configuration-sync request carries the signed lease and a fresh device proof. The server records public device data and revocation state in the existing file-backed authentication storage. Renewal begins during the final seven days. An unexpired lease permits offline startup; expiry fails closed. Revocation prevents subsequent renewal and synchronization, but the server cannot recall a lease from an offline device before its signed expiry.

## Credential and model sync

`@deepseek-ai/dsh-credentials-windows` stores one versioned credential document protected by Windows CurrentUser DPAPI and replaced atomically without plaintext staging. Organization model keys arrive only inside the device's encrypted configuration and occupy reserved `desktop-org-*` references and model routes. A later sync replaces that reserved set while retaining personal credential references and records. The Web UI does not display organization keys, and another Windows account cannot decrypt the file; a user who controls the authorized Windows account and its processes can still extract a key used locally. Administrators therefore treat each activated device as a key holder and rotate organization credentials after device compromise.

The server signing private JWK and administrator-managed model keys remain in the server credentials provider. The installer contains only the signing public JWK. The server exposes administrator-only public-key, device-list, and revocation routes; it never returns the private signing key or raw organization keys from those routes.

## Alternatives considered

**Browser-only Electron shell.** This reduces installer size, but it cannot run local projects offline and reproduces the server client instead of packaging the requested complete desktop application.

**One server container per desktop user.** This preserves process isolation but reintroduces the startup latency and operating cost that the single-process multi-user server was designed to avoid; it also does not provide local Windows project execution.

**Mount Cordis directly in Electron.** This creates a second application-launch path and bypasses the supported `dsh` profile lifecycle. Starting the normal packaged CLI keeps one launch contract.

**Ship shared keys in environment variables or installer configuration.** Those values are extractable and cannot be rotated per synchronized configuration. Device-bound encryption and DPAPI keep raw keys out of GitHub variables, installer metadata, and plaintext disk files.

**Reuse a browser session cookie as the desktop authorization.** Browser cookies are revocable online sessions and do not express device possession or bounded offline permission. Signed device leases make the offline duration explicit.

## Consequences

The pilot produces a self-contained Windows installer and keeps the local Harness architecture on its supported profile entrypoint. It reuses server OIDC identity, preserves file-backed server storage, gives administrators bounded device revocation, and keeps organization and personal model credentials separate at rest.

The installer is larger than a WebView shell and Windows SmartScreen may warn because it is unsigned. A revoked offline device may continue until its current lease expires. DPAPI protects credentials at rest but cannot hide a locally usable key from the authorized Windows account. GitHub Actions requires the deployed server's public signing JWK before it can construct a usable installer. CI construction establishes that the staged Windows runtime can load its complete desktop profile, initialize DPAPI credentials, and serve the process-token-authenticated page. The packaged Squirrel probe establishes only that an installer lifecycle process exits promptly; startup diagnostics and safe mode support later failure classification. CI does not establish hardware acceptance: installation, OIDC activation, persistence across Windows logins, browser automation, Office upload, model use, offline behavior, upgrade, and uninstall remain unverified until the deferred Windows hardware run.
