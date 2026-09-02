# 奉中附小 DSH Windows desktop

English | [中文](README.zh.md)

The Electron shell packages a complete Windows x64 DSH runtime and starts its only supported Node application through `dsh --profile desktop`. First launch uses the system browser for the server's existing OIDC flow. A server-signed 30-day device lease permits offline use; the client renews inside the final seven days and synchronizes administrator-managed model sites when online. Device private keys and cached activation state use Electron `safeStorage`; model API keys use the DPAPI credential provider.

An ESM bootstrap handles Squirrel install, update, uninstall, and obsolete-process events using only Node built-ins before it dynamically imports the Electron application. The desktop build embeds every non-Electron JavaScript dependency in that main module, so the installed shell does not resolve Harness workspace packages from `resources/app`. The shell disables hardware acceleration, displays activation status without automatically starting DSH, and launches the local runtime only after the user selects **Start local DSH**. Starting `FZFX-DSH.exe --safe-mode` opens the shell without contacting the server or starting the runtime. Bounded, credential-redacted startup diagnostics are stored as `logs/desktop-startup.jsonl` below Electron's user-data directory.

`windows-desktop.yml` builds the unsigned pilot installer. Repository Actions variables must provide `DSH_DESKTOP_SERVER_SIGNING_PUBLIC_JWK`; `DSH_DESKTOP_SERVER_ORIGIN` defaults to `http://10.155.44.246:3081`. Before packaging, the Windows runner starts the staged runtime and requests its process-token-authenticated page. It materializes hoisted runtime and Electron Forge dependency trees in short staging paths instead of packaging pnpm workspace or virtual-store links, which also keeps Squirrel's NuGet input below its Windows path limit. Because these isolated trees skip dependency install scripts, the packaging script explicitly selects electron-winstaller's x64 7-Zip executable and library before invoking Squirrel. After packaging, the runner requires both the Squirrel obsolete-process event and an import of the normal Electron main module to exit successfully within fifteen seconds; the second probe catches unresolved packaged dependencies before artifact upload without starting the application lifecycle. The output contains `FZFX-DSH-Setup.exe`, its SHA-256 file, and a build manifest. A Windows hardware acceptance run remains required before describing the pilot as production-ready.

## Local construction checks

```sh
pnpm run build:desktop
pnpm exec vitest run apps/desktop/tests/runtime.spec.ts
```

The installer itself is assembled only on Windows by `.github/scripts/build-windows-desktop.ps1` after the repository build has emitted every runtime package and Web asset.
