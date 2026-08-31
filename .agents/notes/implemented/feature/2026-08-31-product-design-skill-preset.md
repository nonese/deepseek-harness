# Agent Note: Product Design skill preset

Status: implemented

English | [中文](2026-08-31-product-design-skill-preset.zh.md)

## Problem

DSH could expose project files, standard coding tools, and specialized teaching tools, but it had no packaged workflow for product research, interface audit, visual exploration, screenshot or URL implementation, design verification, and controlled sharing. The Codex Product Design plugin defined that workflow, but its implementation assumed Codex-host services such as saved host context, browser screenshot control, image generation, and managed publishing. Copying those assumptions into a long-running multi-user DSH process would either advertise tools that do not exist or place user design context in process-global storage.

## Decision

`@deepseek-ai/dsh-skill-product-design` registers ten immutable, user- and model-invocable skill definitions in the mounting skill layer: a router plus onboarding, context, research, audit, visual ideation, image-to-code, URL-to-code, design QA, and sharing. The definitions preserve the Product Design ordering rules: inspect existing product context and design systems first; require a visual source before matching or cloning; select a visual direction before implementation; compare the reference and implementation at the same viewport and state; and publish only on an explicit request.

The DSH port treats host integrations as capabilities rather than implied services. Standard Web, filesystem, shell, and attachment tools support research and implementation when present. Visual ideation stops without an image-generation tool, visual QA reports a blocker without browser capture and a reference, and sharing uses only an explicitly approved installed publishing target. The skills prohibit fabricated visible assets and do not replace missing visual artifacts with prose, ASCII, CSS drawings, or handcrafted SVG.

Durable context lives at `product-design/user-context.md` inside the current Session Workspace. The skill pack stores no mutable process-global state, credential, or cross-project profile. Workspace authority remains with the authenticated DSH filesystem path, so the existing tenant isolation applies to every design-context read and write.

`product-design` is a shipped agent preset derived from the standard composition. It replaces the persona with product-design guidance and mounts the skill pack beside the existing skill filesystem and consumer. The package contribution is scoped to the preset's standing mount, so a standard session in the same process cannot discover the Product Design skills. The CLI declares the package as a resolver dependency so the shipped composition can load from an installed release.

## Alternatives considered

**Copy the Codex plugin unchanged.** Rejected because Browser, ImageGen, Sites, Figma, and saved host context are Codex-host capabilities rather than DSH services. Advertising them without providers would create false completion claims and unpredictable fallbacks.

**Store one Product Design profile under the process user's home.** Rejected because a single DSH process serves many authenticated users. A host-global file would share product URLs, screenshots, and design preferences across tenants.

**Put the workflow only in a long persona prompt.** Rejected because every request would pay the full token cost, users could not invoke a focused stage directly, and the standard skill catalog already owns progressive discovery and loading.

**Add browser automation, image generation, and publishing in the same change.** Rejected because each is an independent capability with its own provider, authorization, data, and deployment requirements. The workflow fails closed until a deployment installs those capabilities explicitly.

## Consequences

- Users can select 产品设计模式 for a standard-capability agent with a complete Product Design workflow catalog.
- Product design context and assets remain inside the current private project and inherit existing multi-user workspace isolation.
- The skill pack is useful immediately for source-backed research, codebase audits, and implementation from supplied visuals; visual ideation and automated comparison remain unavailable until compatible providers are installed.
- Package tests pin the ten definitions and guardrails, scope tests prove no cross-preset leakage, and a keyless Web composition test mounts both Product Design and Standard sessions in one process and records the persona and catalog difference.
