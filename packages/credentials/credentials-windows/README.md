---
description: "Windows CurrentUser DPAPI credential provider for the packaged DSH desktop runtime."
kind: "package-reference"
---

# @deepseek-ai/dsh-credentials-windows

English | [中文](README.zh.md)

## Summary

This provider stores the complete credential-reference and credential-record document as one CurrentUser DPAPI ciphertext. It sends plaintext to a non-interactive PowerShell DPAPI helper over stdin, never an environment variable or command argument, and atomically replaces only encrypted bytes. The desktop launcher uses `replaceWindowsCredentialRefs` while DSH is stopped to reconcile its organization-owned namespace without removing personal credentials.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

Mount it as the `credentials` row in the Windows `desktop` profile. The default file is `<DSH_HOME>/credentials.dpapi`. Only the same Windows account can decrypt it; copying the file to another user profile does not transfer the keys.

## Model Experience

Indirectly, through consumers of `ctx.credentials` that own any model-facing behavior.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- This provider is Windows-only and depends on Windows PowerShell plus CurrentUser DPAPI.
- It intentionally has no live file watcher because one desktop process owns the document.

<a id="dev-note"></a>
### Dev Note

The test protector is injectable so non-Windows CI can verify durable layout, atomic updates, and absence of plaintext without claiming a Windows DPAPI hardware result.
