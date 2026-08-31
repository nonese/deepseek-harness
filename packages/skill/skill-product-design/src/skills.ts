/** Product-design skill definitions owned by the packaged workflow. */

import type { SkillRegistration } from '@deepseek-ai/dsh-skill'

const INVOCATION = { modelInvocable: true, userInvocable: true } as const
const SOURCE = 'bundled' as const
const PROVIDER = 'product-design'

/** Complete Product Design workflow catalog registered by the package. */
export const PRODUCT_DESIGN_SKILLS: readonly SkillRegistration[] = [
  {
    name: 'product-design',
    description: 'Route product-design work through context, research, visual direction, implementation, QA, and explicit sharing.',
    whenToUse: 'Use first for any product, interface, UX, visual audit, redesign, prototype, screenshot-to-code, or URL-to-code request.',
    source: SOURCE,
    provider: PROVIDER,
    invocation: INVOCATION,
    content: `# Product Design router

Own the complete product-design workflow for the current project. Start by loading \`product-design-context\`, which reads \`product-design/user-context.md\` when present. If no saved context exists and durable product details would materially improve the work, load \`product-design-onboarding\`.

Route the request to the smallest sufficient workflow:

- evidence gathering or competitor study: \`product-design-research\`
- critique of an existing experience: \`product-design-audit\`
- alternative visual directions: \`product-design-ideate\`
- a supplied image or screenshot implemented in code: \`product-design-image-to-code\`
- a live URL reproduced in code: \`product-design-url-to-code\`
- visual and interaction verification: \`product-design-qa\`
- publication or team handoff: \`product-design-share\`

For an existing codebase, inspect its similar screens, components, tokens, assets, routes, and interaction patterns before proposing or editing anything. Preserve the existing stack and design system unless the user explicitly requests a new direction.

Treat tools as capabilities, not assumptions. The shipped Product Design preset provides \`generate_image\` and \`collect_generated_image\` through Dreamina CLI; use them for real visual assets and keep outputs below \`product-design/\`. If \`generate_image\` returns a pending task, resume that task with \`collect_generated_image\` instead of submitting a duplicate. Use attached images, Web search/fetch, filesystem, shell, browser capture, and publishing only when they are actually present. If a required screenshot, browser comparison, or publishing target is unavailable, say exactly which capability is missing and stop that dependent step. Never substitute ASCII art, emoji, placeholder rectangles, handcrafted SVG drawings, or prose-only visual options for a required visual artifact.

Keep durable design context and generated design material under \`product-design/\` inside the current workspace. Never read another workspace or a host-global profile for product context. Preview and verify locally before any publication, and publish only after an explicit user request. End each completed stage with one concrete next action.`,
  },
  {
    name: 'product-design-onboarding',
    description: 'Create or update workspace-scoped product-design context without storing secrets.',
    whenToUse: 'Use when product-design/user-context.md is missing, stale, or the user asks to save design preferences and references.',
    source: SOURCE,
    provider: PROVIDER,
    invocation: INVOCATION,
    content: `# Product Design onboarding

Maintain \`product-design/user-context.md\` in the current workspace. This file belongs to this project and user only.

Inspect the workspace first and ask only for durable information that cannot be discovered safely: product purpose and audience, primary flows, product or reference URLs, screenshot paths, design-system or Storybook location, brand assets, target platforms and viewports, preferred browser when capture is available, and approved share targets. Do not ask for API keys, passwords, cookies, client secrets, or other credentials, and do not write them to the context file.

Use this structure:

## Product
- Purpose:
- Audience:
- Primary flows:

## Visual system
- Design-system source:
- Tokens and components:
- Brand assets:
- Reference screenshots or URLs:

## Delivery
- Target platforms and viewports:
- Browser preference:
- Approved share targets:

## Constraints
- Accessibility, content, legal, performance, or implementation constraints:

Preserve still-valid entries when updating the file. Report the relative path and the fields changed.`,
  },
  {
    name: 'product-design-context',
    description: 'Load saved workspace product context and inspect the existing design system before design work.',
    whenToUse: 'Use at the start of every Product Design request in an existing workspace.',
    source: SOURCE,
    provider: PROVIDER,
    invocation: INVOCATION,
    content: `# Get Product Design context

Read \`product-design/user-context.md\` when it exists. Then inspect the current workspace for the nearest matching flow, screen, component, route, styles, tokens, font setup, icons, images, Storybook stories, and tests. Prefer fast file discovery and targeted reads over broad dumps.

Return a compact context brief with:

- the current product and requested user journey;
- reusable components, assets, tokens, and relevant file paths;
- target viewport or platform and visible states;
- explicit constraints and unresolved user-owned choices;
- which Product Design workflow should run next.

Do not infer a new visual language when the workspace already defines one. Do not cross the current workspace root. If no usable visual source exists for a clone or match request, request a screenshot or capturable URL before design or implementation.`,
  },
  {
    name: 'product-design-research',
    description: 'Gather source-backed product and interface evidence that leads to explicit design decisions.',
    whenToUse: 'Use for competitor comparisons, pattern research, current product evidence, or source-backed design recommendations.',
    source: SOURCE,
    provider: PROVIDER,
    invocation: INVOCATION,
    content: `# Product Design research

Define the decision the research must support before searching. Reuse saved context and inspect the existing product first. Use available Web search/fetch or user-supplied sources; do not claim to have viewed a page that was not captured or opened.

Prefer primary sources, current product documentation, accessible live products, and direct screenshots. Record each material claim as: source, observed evidence, date or version when relevant, and the design decision it informs. Separate observation from inference.

Deliver a concise evidence table followed by recommended decisions and open risks. Do not build a prototype during research. If the user asks for visual alternatives after research, route to \`product-design-ideate\`.`,
  },
  {
    name: 'product-design-audit',
    description: 'Audit an existing product flow for usability, visual consistency, accessibility, and implementation risk.',
    whenToUse: 'Use when the user asks for a critique, UX review, design audit, heuristic review, or prioritized interface findings.',
    source: SOURCE,
    provider: PROVIDER,
    invocation: INVOCATION,
    content: `# Product Design audit

Audit only evidence you can inspect: supplied screenshots, an available browser capture, or the existing source and rendered states. Establish the target user, primary task, viewport, and expected path.

Check task completion, information hierarchy, navigation, feedback and error recovery, visual consistency, density and spacing, typography, contrast, focus and keyboard behavior, responsive behavior, content clarity, empty/loading/error states, and implementation divergence from the product's own design system.

Report findings in priority order:

- P0: blocks the primary task or creates serious access or data risk;
- P1: materially harms completion, comprehension, or accessibility;
- P2: visible inconsistency or polish issue with bounded impact.

For each finding include evidence, user impact, affected state or file, and a concrete recommendation. Distinguish confirmed findings from items needing browser verification. Do not edit code unless the user also asks for fixes.`,
  },
  {
    name: 'product-design-ideate',
    description: 'Generate and compare genuinely visual product-design directions before implementation.',
    whenToUse: 'Use when the user requests design options, a new visual direction, a redesign, or exploration before choosing a build target.',
    source: SOURCE,
    provider: PROVIDER,
    invocation: INVOCATION,
    content: `# Product Design ideation

Load product context and define the exact screen, state, viewport, and primary task. Use \`generate_image\` to create two to four materially different visual directions as Dreamina 4.0 2K PNG artifacts under \`product-design/\`. Measure the intended slot first and choose the matching aspect ratio. Include the real product copy, key controls, and realistic data needed to judge the core experience. If a task remains pending, call \`collect_generated_image\` with the returned task id and original output path; do not submit another image.

Keep brand assets, required information architecture, and existing design-system constraints unless the user asks to change them. Do not represent options with prose, ASCII wireframes, emoji, placeholder boxes, CSS sketches, or handcrafted SVG drawings. If the Dreamina provider reports that the CLI is unavailable or not logged in, stop and report that concrete provider error; do not replace the required images with a synthetic alternative.

Present the generated images with short labels and only the differences needed for selection. Do not implement until the user selects a visual target.`,
  },
  {
    name: 'product-design-image-to-code',
    description: 'Implement a selected screenshot or generated design in the existing product stack with visual comparison.',
    whenToUse: 'Use after the user supplies or selects an image, screenshot, mockup, or generated design as the implementation target.',
    source: SOURCE,
    provider: PROVIDER,
    invocation: INVOCATION,
    content: `# Image to code

Open the selected source image and measure its viewport, layout regions, spacing, typography, color, borders, radii, shadows, cropping, and interactive states. Inspect the existing codebase and reuse its stack, components, tokens, icons, and real assets. Do not reinitialize an existing application.

Implement the smallest route and component set needed for the visible core journey. Navigation, primary actions, tabs, menus, forms, filters, selections, loading, empty, error, and success states visible in the target must work with realistic data. Controls outside the core journey may remain visual-only when identified clearly.

Never fake visible assets with CSS art, inline SVG, emoji, or placeholder rectangles. Use supplied assets, the closest installed icon library, or \`generate_image\` with an output path and aspect ratio sized for the measured slot.

Run the product locally, capture the implementation at the same viewport and state as the reference, and compare both together through \`product-design-qa\`. Fix visible differences and repeat. If browser capture is unavailable, report the build as awaiting visual QA rather than claiming an exact match.`,
  },
  {
    name: 'product-design-url-to-code',
    description: 'Reproduce a live URL as a local frontend after source capture and inspection.',
    whenToUse: 'Use when the user provides a URL and asks to clone, reproduce, or implement its visible frontend.',
    source: SOURCE,
    provider: PROVIDER,
    invocation: INVOCATION,
    content: `# URL to code

Use only the user's chosen browser when browser automation is available. Capture and open the target URL at the required viewport before designing or coding. Inspect the visible states and source assets that the user is authorized to reproduce. If the URL cannot be captured and no current screenshot is supplied, stop before implementation; fetched HTML or prose alone is not a visual reference.

Inspect the destination repository and preserve its framework, build system, tokens, and components. Reproduce the requested visible route and core interactions with real or authorized assets. Do not add unrelated pages.

Run locally and use \`product-design-qa\` to compare reference and implementation screenshots at the same viewport and state. Do not publish automatically and do not claim pixel accuracy without the comparison.`,
  },
  {
    name: 'product-design-qa',
    description: 'Verify a product-design implementation through functional checks and same-state visual comparison.',
    whenToUse: 'Use after implementation and after every material visual adjustment, before calling a design build complete.',
    source: SOURCE,
    provider: PROVIDER,
    invocation: INVOCATION,
    content: `# Product Design QA

Verify the core journey first: navigation, links, primary actions, form validation, keyboard and focus behavior, loading, empty, error and success states, responsive behavior, and console or network failures when those tools are available.

For visual QA, capture the implementation at the same viewport, zoom, content, scroll position, and state as the reference. Compare the reference and implementation together, checking layout geometry, image crop, spacing, typography, weight, color, contrast, borders, radii, shadows, alignment, overflow, and responsive breakpoints. A screenshot by itself is not a comparison.

Fix confirmed mismatches, recapture, and compare again until no material difference remains or an explicit constraint prevents it. Report tested viewports, interactions, remaining deviations, and their cause. If no browser capture or reference image is available, mark visual QA blocked and do not claim a verified match.`,
  },
  {
    name: 'product-design-share',
    description: 'Publish or hand off a locally verified design build through an explicitly approved target.',
    whenToUse: 'Use only when the user explicitly asks to share, publish, deploy, or hand the design to a team.',
    source: SOURCE,
    provider: PROVIDER,
    invocation: INVOCATION,
    content: `# Share a Product Design build

Confirm the build has passed local functional and visual QA. Read the approved share targets in \`product-design/user-context.md\` and inspect the currently available publishing tools. Use a target only when the user explicitly requests it or approves the exact target during this task.

Keep the verified project intact. Do not replace it with another starter, change hosting configuration unrelated to the target, expose secrets, or publish private source material unintentionally. If no approved publishing tool is available, provide a clear local handoff with the project path, run command, verification status, and remaining manual publishing step.

After a successful share, report the target, immutable revision or deployment identifier when available, access scope, and rollback path.`,
  },
]
