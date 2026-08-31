import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

describe('Product Design agent preset', () => {
  let scaffold: WebScaffold
  let designHandle: AgentHandle
  let standardHandle: AgentHandle

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    designHandle = await scaffold.ctx.agents.create({
      sessionId: SessionId('product-design-preset-smoke'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'product-design' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'product-design').then(() => undefined),
    })
    standardHandle = await scaffold.ctx.agents.create({
      sessionId: SessionId('product-design-standard-control'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'standard' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
    })
  })

  afterAll(async () => {
    await standardHandle?.dispose()
    await designHandle?.dispose()
    await scaffold?.close()
  })

  it('assembles the design persona and exposes the complete workflow only to that preset', async () => {
    const prompt = await scaffold.ctx.systemPrompt.assemble({ scope: designHandle.agent })
    const persona = prompt.sections.find(section => section.text.includes('Harness Product Designer'))
    const designSkills = (await scaffold.ctx.skills.list({
      scope: designHandle.agent,
      cwd: scaffold.workspaceCwd,
    })).filter(skill => skill.provider === 'product-design')
    const standardSkills = (await scaffold.ctx.skills.list({
      scope: standardHandle.agent,
      cwd: scaffold.workspaceCwd,
    })).filter(skill => skill.provider === 'product-design')
    const imageToolNames = ['collect_generated_image', 'generate_image']
    const designImageTools = scaffold.ctx.tools.schemas(designHandle.agent)
      .map(tool => tool.name).filter(name => imageToolNames.includes(name)).sort()
    const standardImageTools = scaffold.ctx.tools.schemas(standardHandle.agent)
      .map(tool => tool.name).filter(name => imageToolNames.includes(name)).sort()
    const router = await scaffold.ctx.skills.get('product-design', {
      scope: designHandle.agent,
      cwd: scaffold.workspaceCwd,
    })

    expect({
      persona: persona?.text.replaceAll(scaffold.workspaceCwd, '{{cwd}}').trim(),
      designSkills: designSkills.map(skill => ({ name: skill.name, description: skill.description })),
      designImageTools,
      standardSkills,
      standardImageTools,
      routerGuardrails: router?.content.includes('Treat tools as capabilities, not assumptions') === true,
    }).toMatchInlineSnapshot(`
      {
        "designImageTools": [
          "collect_generated_image",
          "generate_image",
        ],
        "designSkills": [
          {
            "description": "Route product-design work through context, research, visual direction, implementation, QA, and explicit sharing.",
            "name": "product-design",
          },
          {
            "description": "Audit an existing product flow for usability, visual consistency, accessibility, and implementation risk.",
            "name": "product-design-audit",
          },
          {
            "description": "Load saved workspace product context and inspect the existing design system before design work.",
            "name": "product-design-context",
          },
          {
            "description": "Generate and compare genuinely visual product-design directions before implementation.",
            "name": "product-design-ideate",
          },
          {
            "description": "Implement a selected screenshot or generated design in the existing product stack with visual comparison.",
            "name": "product-design-image-to-code",
          },
          {
            "description": "Create or update workspace-scoped product-design context without storing secrets.",
            "name": "product-design-onboarding",
          },
          {
            "description": "Verify a product-design implementation through functional checks and same-state visual comparison.",
            "name": "product-design-qa",
          },
          {
            "description": "Gather source-backed product and interface evidence that leads to explicit design decisions.",
            "name": "product-design-research",
          },
          {
            "description": "Publish or hand off a locally verified design build through an explicitly approved target.",
            "name": "product-design-share",
          },
          {
            "description": "Reproduce a live URL as a local frontend after source capture and inspection.",
            "name": "product-design-url-to-code",
          },
        ],
        "persona": "You are Harness Product Designer, a senior product designer and frontend implementation partner powered by the {{model}} model. Your working directory is {{cwd}}.

      Ground every design decision in the current user's workspace, saved product context, inspectable visual references, and the product's existing design system. Use the Product Design skill router for product, interface, UX, visual audit, redesign, prototype, screenshot-to-code, and URL-to-code work.

      Separate research, visual selection, implementation, verification, and publication. Use the mounted Dreamina generator for real visual assets, never invent or fake visible assets, and do not publish without an explicit request. Keep durable design context and assets under product-design/ in the current workspace, preview locally first, and end each completed stage with one concrete next action.",
        "routerGuardrails": true,
        "standardImageTools": [],
        "standardSkills": [],
      }
    `)
  }, 120_000)
})
