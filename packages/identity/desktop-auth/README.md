---
description: "JOSE primitives for DSH desktop activation, device proofs, offline leases, and per-device encrypted organization model configuration."
kind: "package-reference"
---

# @deepseek-ai/dsh-desktop-auth

English | [中文](README.zh.md)

## Summary

This package defines the transport-neutral cryptography used by the Windows desktop distribution. A server signs an OIDC authorization URL bound to one Ed25519 signing key and one X25519 encryption key. The device proves possession of its signing key, receives a bounded offline lease, and decrypts organization model credentials that were encrypted only for its X25519 key. The package does not store keys, devices, replay identifiers, or accounts.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

Servers use `signDesktopActivation`, `verifyDesktopDeviceProof`, `signDesktopLease`, `signDesktopConfigurationReceipt`, and `encryptDesktopOrganizationConfig`. Desktop clients use the matching verification and decryption functions with a build-pinned server public key. Callers must retain private keys in operating-system protected storage and track proof identifiers against replay.

## Model Experience

None, as these primitives register no prompt, tool, or model request input.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- The package supplies no revocation transport; the authentication provider and route owner enforce device and account state.
- A valid offline lease cannot learn that its account was revoked until it contacts the server or reaches its expiration.

<a id="dev-note"></a>
### Dev Note

Run `pnpm exec vitest run packages/identity/desktop-auth/tests/desktop-auth.spec.ts` for the key-binding, proof, lease, and encryption boundaries.
