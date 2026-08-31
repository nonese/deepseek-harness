import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

describe('teacher agent preset', () => {
  let scaffold: WebScaffold
  let agentHandle: AgentHandle

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    agentHandle = await scaffold.ctx.agents.create({
      sessionId: SessionId('teacher-preset-smoke'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'teacher' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'teacher').then(() => undefined),
    })
  })

  afterAll(async () => {
    await agentHandle?.dispose()
    await scaffold?.close()
  })

  it('assembles the teaching prompt and generates each Office artifact through the shipped composition', async () => {
    const prompt = await scaffold.ctx.systemPrompt.assemble({ scope: agentHandle.agent })
    const teacherSection = prompt.sections.find(section => section.text.includes('Harness Teacher'))
    const documentToolNames = new Set(['create_word_document', 'create_presentation', 'create_spreadsheet'])
    const documentTools = scaffold.ctx.tools.schemas(agentHandle.agent)
      .filter(tool => documentToolNames.has(tool.name))
      .map(tool => ({ name: tool.name, description: tool.description }))
    expect({ teacherSection: teacherSection?.text.replaceAll(scaffold.workspaceCwd, '{{cwd}}').trim(), documentTools }).toMatchInlineSnapshot(`
      {
        "documentTools": [
          {
            "description": "Create a styled Word document in the current project. Use it for lesson plans, handouts, reports, rubrics, and structured teaching documents. The output path must be relative and end with .docx.",
            "name": "create_word_document",
          },
          {
            "description": "Create a clear widescreen PowerPoint deck in the current project. Use concise slide titles, keep content slides focused, and use two-column slides only for genuine comparisons. The output path must end with .pptx.",
            "name": "create_presentation",
          },
          {
            "description": "Create a styled Excel workbook in the current project. Use it for gradebooks, schedules, assessment analysis, rosters, and structured teaching data. Prefer formulas for derived values. The output path must end with .xlsx.",
            "name": "create_spreadsheet",
          },
        ],
        "teacherSection": "You are Harness Teacher, a professional teaching assistant powered by the {{model}} model. Your working directory is {{cwd}}.

      Help teachers design accurate, age-appropriate lessons, classroom activities, assessments, handouts, presentations, and teaching data. Establish the subject, grade or learner level, objectives, available class time, and required curriculum constraints from the request and workspace context. Ask only for material choices that cannot be inferred safely.

      A lesson plan should make objectives, key concepts and difficulties, lesson sequence, assessment evidence, differentiation, and follow-up work explicit. A presentation should keep one main idea per slide, use concise student-facing text, and put delivery guidance in speaker notes. A spreadsheet should use clear headers, formulas for derived values, frozen headers, filters, and suitable number formats. Save created artifacts under the current project with descriptive relative filenames, verify generation succeeded, and report every output path.",
      }
    `)

    const signal = new AbortController().signal
    const word = await scaffold.ctx.tools.execute({
      signal, agent: agentHandle.agent, callId: ToolCallId('teacher-word'), name: 'create_word_document',
      arguments: {
        output_path: 'teacher-lesson.docx', title: '光合作用教案',
        sections: [{ heading: '教学目标', bullets: ['解释光合作用的基本过程'] }],
      },
    })
    const presentation = await scaffold.ctx.tools.execute({
      signal, agent: agentHandle.agent, callId: ToolCallId('teacher-ppt'), name: 'create_presentation',
      arguments: {
        output_path: 'teacher-lesson.pptx', title: '光合作用',
        slides: [{ kind: 'title', title: '光合作用' }, { kind: 'content', title: '学习目标', bullets: ['理解基本过程'] }],
      },
    })
    const spreadsheet = await scaffold.ctx.tools.execute({
      signal, agent: agentHandle.agent, callId: ToolCallId('teacher-xlsx'), name: 'create_spreadsheet',
      arguments: {
        output_path: 'teacher-scores.xlsx',
        sheets: [{ name: '成绩', columns: ['姓名', '分数'], rows: [['小明', 95]] }],
      },
    })
    const compact = (result: typeof word) => {
      if (result.isError || typeof result.value !== 'object' || result.value === null) return { isError: result.isError }
      const value = result.value as Record<string, unknown>
      return {
        isError: false,
        kind: value.kind,
        path: value.path,
        itemCount: value.itemCount,
        validation: value.validation,
      }
    }
    expect([compact(word), compact(presentation), compact(spreadsheet)]).toMatchInlineSnapshot(`
      [
        {
          "isError": false,
          "itemCount": 1,
          "kind": "docx",
          "path": "teacher-lesson.docx",
          "validation": "ooxml",
        },
        {
          "isError": false,
          "itemCount": 2,
          "kind": "pptx",
          "path": "teacher-lesson.pptx",
          "validation": "ooxml",
        },
        {
          "isError": false,
          "itemCount": 1,
          "kind": "xlsx",
          "path": "teacher-scores.xlsx",
          "validation": "ooxml",
        },
      ]
    `)
    for (const path of ['teacher-lesson.docx', 'teacher-lesson.pptx', 'teacher-scores.xlsx']) {
      expect((await readFile(join(scaffold.workspaceCwd, path))).subarray(0, 2).toString()).toBe('PK')
    }
  }, 120_000)
})
