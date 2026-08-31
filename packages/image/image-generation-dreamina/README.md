---
description: "Local Dreamina CLI provider pinned to image 4.0 and 2K for workspace PNG generation."
kind: "package-reference"
---

# @deepseek-ai/dsh-image-generation-dreamina

English | [中文](README.zh.md)

## Summary

`dsh-image-generation-dreamina` implements `ctx.imageGeneration` by invoking the logged-in local `dreamina` CLI through DSH's managed subprocess service. It submits `text2image`, pins model `4.0` and resolution `2k`, polls in the foreground, resumes incomplete tasks through `query_result`, validates the downloaded PNG, and publishes it atomically inside the calling workspace.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider in the same service realm as a consumer:

```yaml
- name: '@deepseek-ai/dsh-image-generation-dreamina'
  config:
    cliPath: !!js process.env.DREAMINA_CLI_PATH
    modelVersion: '4.0'
    resolution: 2k
    pollSeconds: 240
```

Run DSH as the same operating-system account that completed `dreamina login`. `cliPath` accepts an absolute executable or a bare PATH name and defaults to `dreamina`. The provider never receives a Dreamina password, cookie, API key, or login response through its configuration.

On a host whose glibc cannot run the CLI, the provider can invoke a logged-in Dreamina CLI inside an already-running local Docker container. The host and container download roots must be the two sides of the same bind mount:

```yaml
- name: '@deepseek-ai/dsh-image-generation-dreamina'
  config:
    cliPath: dreamina
    dockerContainer: dreamina-mcp
    dockerHostDownloadRoot: /srv/dreamina/runtime
    dockerContainerDownloadRoot: /data
    dockerPath: /usr/bin/docker
```

The Docker mode calls `docker exec` with argv arrays; it does not create, restart, or reconfigure the container. The configured DSH operating-system account must already be allowed to execute Docker, and the named container must already be running.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

Every model value becomes one argv element; no shell parses the prompt. DSH subprocess scrubs credential-shaped ambient variables and owns process-tree cancellation. The provider caps stdout/stderr, accepts JSON only, validates task ids and statuses, downloads into a private random directory, rejects link-shaped/non-PNG/oversized output, and removes flat temporary entries without recursive link traversal. Docker mode additionally confines each reported container path to the random bind-mounted directory before translating it to a host path.

Before submission, the provider resolves the output under the real workspace root and rejects hidden/traversal/symlink/conflict targets. Completed bytes use an owner-only temporary file and atomic publication. One promise queue serializes submit and collect operations for the mounted Dreamina account.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Service Definition](../image-generation/README.md) — provider-independent requests and outcomes.
- [Model-facing tools](../tool-image-generation/README.md) — workspace and durable-attachment projection.
- [Defensive patterns](../../../docs/defensive-patterns.md) — subprocess and path-cleanup rules.

-----

<a id="model-experience"></a>
## Model Experience

### Provider results

#### What the model sees

The provider adds no schema by itself. When `dsh-tool-image-generation` calls it, completed results expose the provider name, model `4.0`, resolution `2k`, dimensions, and workspace-relative PNG path; pending results expose an opaque task id for collection.

#### Token effect

No fixed request-prefix cost. Provider facts enter context only through a tool result after a submit or collect call.

#### KV Cache effect

Provider configuration is absent from the stable request prefix. Per-call result metadata and generated image content extend session history after completion and therefore affect reuse after that point.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only `text2image` is exposed; Dreamina reference-image modes and video commands are not part of this provider version.
- The provider uses the host account's Dreamina login and point balance. Its single queue prevents overlap but does not assign per-DSH-user quotas.
- Docker mode depends on an externally managed, already-running container and a correctly paired bind mount; the provider does not manage that container lifecycle.
- A pending task requires the consumer to call `collect()` later; the provider does not create a background job or notification.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The shipped Product Design preset owns the first composition. Keep model/version defaults explicit in that preset and provider config rather than hardcoding them inside the tool consumer.

</details>
