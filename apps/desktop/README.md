# 奉中附小 DSH Windows desktop

English | [中文](README.zh.md)

The Electron shell packages a complete Windows x64 DSH runtime and starts its only supported Node application through `dsh --profile desktop`. First launch uses the system browser for the server's existing OIDC flow. A server-signed 30-day device lease permits offline use; the client renews inside the final seven days and synchronizes administrator-managed model sites when online. Device private keys and cached activation state use Electron `safeStorage`; model API keys use the DPAPI credential provider.

`windows-desktop.yml` builds the unsigned pilot installer. Repository Actions variables must provide `DSH_DESKTOP_SERVER_SIGNING_PUBLIC_JWK`; `DSH_DESKTOP_SERVER_ORIGIN` defaults to `http://10.155.44.246:3081`. Before packaging, the Windows runner starts the staged runtime and requests its process-token-authenticated page. The output contains `FZFX-DSH-Setup.exe`, its SHA-256 file, and a build manifest. A Windows hardware acceptance run remains required before describing the pilot as production-ready.

## Local construction checks

```sh
pnpm run build:desktop
pnpm exec vitest run apps/desktop/tests/runtime.spec.ts
```

The installer itself is assembled only on Windows by `.github/scripts/build-windows-desktop.ps1` after the repository build has emitted every runtime package and Web asset.
