---
description: "Workspace-scoped Product Design workflow skills for DSH agents that research, audit, ideate, implement, verify, and explicitly share interface work."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-product-design

English | [中文](README.zh.md)

## Summary

`dsh-skill-product-design` packages the Product Design workflow as ten DSH skills: one router plus onboarding, context, research, audit, visual ideation, image-to-code, URL-to-code, design QA, and sharing. Mount it in an agent preset to give only that preset's sessions the workflow. The shipped `product-design` preset combines this pack with the standard tools and a product-design persona.

The pack keeps durable context under `product-design/` inside the current workspace. It never grants a tool by itself and never assumes Browser capture or publishing exists. The shipped Product Design preset now mounts the provider-neutral image-generation tool over the local Dreamina CLI, pinned to image 4.0 at 2K; other compositions may still select a different provider.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the pack after the skill registry in an agent-scoped composition:

```yaml
- name: '@deepseek-ai/dsh-skill-product-design'
```

The composition must also expose `@deepseek-ai/dsh-tool-skill` so the model can discover and load the registered bodies. The shipped Product Design preset includes the standard filesystem, shell, Web, interaction, and skill consumers plus `@deepseek-ai/dsh-tool-image-generation` backed by `@deepseek-ai/dsh-image-generation-dreamina`. Deployments may add browser or publishing tools independently.

### Workflow catalog

| Skill | Responsibility |
|---|---|
| `product-design` | Routes a request through the smallest sufficient workflow |
| `product-design-onboarding` | Creates or updates workspace-local design context without secrets |
| `product-design-context` | Reads saved context and inspects the existing design system |
| `product-design-research` | Turns source-backed evidence into design decisions |
| `product-design-audit` | Produces prioritized usability, visual, accessibility, and implementation findings |
| `product-design-ideate` | Requires genuinely visual alternatives before implementation |
| `product-design-image-to-code` | Implements a selected screenshot or mockup in the existing stack |
| `product-design-url-to-code` | Captures a live URL before reproducing its requested frontend |
| `product-design-qa` | Verifies the core journey and compares reference and implementation at one state |
| `product-design-share` | Publishes only through an explicitly approved available target |

All ten skills are model- and user-invocable. They use the `bundled` source label and `product-design` provider label. Project-local skills with the same name retain the skill registry's normal higher precedence.

### Workspace and tenant behavior

The workflow path `product-design/user-context.md` is relative to the calling session's current workspace. DSH's authenticated workspace resolution and filesystem policy remain the authority for reads and writes; this pack holds no process-global user profile, API key, cookie, or mutable state. Two sessions on different presets or workspaces therefore do not share a skill layer or design-context file through this package.

### Capability behavior

The original Product Design workflow relies on host capabilities for browser screenshots, visual generation, and publishing. This DSH package keeps browser and publishing requirements fail-closed instead of simulating them. Research can use the standard Web tool when configured. Code inspection and implementation can use the standard filesystem and shell tools. The shipped preset generates workspace PNG assets through Dreamina CLI; same-state screenshot comparison still requires a browser tool or user-supplied captures.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Registration

`apply` registers immutable `SkillRegistration` records through `ctx.skills.register()`. Because the pack is mounted inside the `product-design` standing preset scope, the skill registry stores the records in that scope layer. The registry owns name validation, precedence, caching, lookup, and effect disposal.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Cordis plugin entry and scoped registration loop |
| [`src/skills.ts`](src/skills.ts) | Ten model-visible workflow definitions |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion; the skill registry owns the relevant runtime relationships |
| [`tests/skill-product-design.spec.ts`](tests/skill-product-design.spec.ts) | Catalog, guardrail, scope isolation, and disposal coverage |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Skill registry](../skill/README.md) — provider precedence, scoped layers, discovery, and invocation policy.
- [Agent presets](../../preset/agent-presets/README.md) — per-session composition and the shipped Product Design mode.
- [System prompt subsystem](../../../docs/subsystems/system-prompt.md) — the persona section combined with these skills.

-----

<a id="model-experience"></a>
## Model Experience

### Product Design skill catalog

#### What the model sees

The skill consumer advertises ten summaries with `product-design` names for agents joined to the mounting scope. Loading one returns its complete workflow body, including workspace-context ownership, source requirements, capability checks, verification rules, and the next workflow route.

#### Token effect

Conditional. The skill catalog contributes ten short name-and-description entries to each request for a Product Design agent. A complete body is added only when the model or user loads that skill. Agents on other presets receive no entries from this package.

#### KV Cache effect

Prefix-stable for the life of an agent. The pack registers once before the preset publishes the agent, and its immutable definitions do not change during that session. Loading a body appends request context for that invocation; it does not alter another preset's prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No browser controller** — the package can require source capture and same-state comparison but cannot perform them unless the deployment supplies a compatible browser tool or the user supplies screenshots.
- **Dreamina login is host-local** — generation requires `dreamina` on `PATH` (or `DREAMINA_CLI_PATH`) and a login for the same operating-system account running DSH.
- **One fixed shipped route** — the Product Design preset pins Dreamina image 4.0 at 2K. The capability API remains provider-neutral, but this first provider does not expose model or resolution selection to the agent.
- **No publishing provider** — sharing requires an approved installed target; the pack never deploys through shell commands merely because network access exists.
- **Project-local context only** — saved preferences do not follow a user across unrelated projects. This is intentional for tenant isolation and avoids introducing a second user-profile store.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This package intentionally keeps workflow instructions separate from browser capture, image generation, and publication providers. The shipped preset composes the independent Dreamina image packages without coupling this skill catalog to their implementation.

</details>
