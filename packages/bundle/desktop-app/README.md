---
description: "Windows desktop profile patch: local process authentication, DPAPI credentials, and full-access defaults over the Web surface."
kind: "package-bundle"
---

# @deepseek-ai/dsh-desktop-app

English | [中文](README.zh.md)

## Summary

This patch is the final in-box layer of the `desktop` profile. It disables multi-user server authentication, replaces the server startup provider with a loopback provider that retains Connection's one-time process token, replaces the ordinary credential file with the Windows DPAPI provider, and sets new sessions to `danger-full-access` plus `never` approval. The Electron launcher still starts the normal `dsh --profile desktop` application on loopback; this bundle is not another application entry point.

The shipped profile adds `dsh-browser-playwright@0.1.1` after this layer. Product Design remains available, while the launcher sets `DSH_DISABLE_DREAMINA=1` for the first Windows release.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Model Experience

Indirectly, through the browser and shell consumers mounted by the desktop profile.

#### KV Cache effect

Static tool schemas affect the initial prompt prefix; this patch adds no dynamic text.

## Known Limitations and Deferred Work

- Full filesystem access is an explicit trusted-desktop default and is unsuitable for an untrusted shared Windows account.
- Dreamina image generation remains disabled until its Windows runtime dependency is packaged and accepted.

<a id="dev-note"></a>
### Dev Note

Dump `dsh --profile desktop --dump-config` from the staged Windows runtime to inspect the final composition. The Windows construction workflow additionally starts that runtime and requests its process-token-authenticated page before packaging.
