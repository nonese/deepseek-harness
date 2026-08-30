import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalDocumentArtifactRuntime from '@deepseek-ai/dsh-artifacts-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as DocumentArtifactTools from '@deepseek-ai/dsh-tool-artifacts'

const roots: string[] = []
const signal = new AbortController().signal

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-document-tool-'))
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalDocumentArtifactRuntime)
  await ctx.plugin(DocumentArtifactTools)
  const agent = { session: { header: { cwd: root } } } as never
  return { ctx, root, agent }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('document artifact tools', () => {
  it('exposes three model-facing tools and creates files in the session workspace', async () => {
    const { ctx, root, agent } = await setup()
    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual([
      'create_word_document',
      'create_presentation',
      'create_spreadsheet',
    ])

    const word = await ctx.tools.execute({
      signal, agent, callId: ToolCallId('word'), name: 'create_word_document',
      arguments: {
        output_path: 'lesson.docx', title: 'Lesson Plan',
        sections: [{ heading: 'Objectives', paragraphs: ['Explain the concept.'] }],
      },
    })
    expect(word).toMatchObject({ isError: false, value: { kind: 'docx', path: 'lesson.docx', validation: 'ooxml' } })
    expect((await readFile(join(root, 'lesson.docx'))).subarray(0, 2).toString()).toBe('PK')

    const presentation = await ctx.tools.execute({
      signal, agent, callId: ToolCallId('presentation'), name: 'create_presentation',
      arguments: {
        output_path: 'lesson.pptx', title: 'Lesson',
        slides: [{ kind: 'title', title: 'Lesson' }, { kind: 'content', title: 'Explore', bullets: ['Observe'] }],
      },
    })
    expect(presentation).toMatchObject({ isError: false, value: { kind: 'pptx', path: 'lesson.pptx', itemCount: 2 } })

    const spreadsheet = await ctx.tools.execute({
      signal, agent, callId: ToolCallId('spreadsheet'), name: 'create_spreadsheet',
      arguments: {
        output_path: 'scores.xlsx',
        sheets: [{ name: 'Scores', columns: ['Student', 'Score'], rows: [['Ada', 100]] }],
      },
    })
    expect(spreadsheet).toMatchObject({ isError: false, value: { kind: 'xlsx', path: 'scores.xlsx', itemCount: 1 } })
  })

  it('uses the trusted session workspace and returns safe tool errors', async () => {
    const { ctx, root, agent } = await setup()
    const traversal = await ctx.tools.execute({
      signal, agent, callId: ToolCallId('traversal'), name: 'create_word_document',
      arguments: {
        output_path: '../outside.docx', title: 'Lesson', sections: [{ heading: 'Plan' }],
      },
    })
    expect(traversal.isError).toBe(true)
    expect(traversal.content[0]).toMatchObject({ type: 'text' })

    const missingWorkspace = await ctx.tools.execute({
      signal, callId: ToolCallId('no-workspace'), name: 'create_word_document',
      arguments: {
        output_path: 'inside.docx', title: 'Lesson', sections: [{ heading: 'Plan' }],
      },
    })
    expect(missingWorkspace.isError).toBe(true)
    const emptyWorkspace = await ctx.tools.execute({
      signal,
      agent: { session: { header: { cwd: '' } } } as never,
      callId: ToolCallId('empty-workspace'),
      name: 'create_word_document',
      arguments: {
        output_path: 'inside.docx', title: 'Lesson', sections: [{ heading: 'Plan' }],
      },
    })
    expect(emptyWorkspace.isError).toBe(true)
    await expect(readFile(join(root, 'inside.docx'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('maps optional arguments and exposes pure file-edit presentation metadata', async () => {
    const { ctx, root, agent } = await setup()
    expect(ctx.tools.get('create_word_document')?.presentCall?.({
      output_path: 'plan.docx', title: 'Plan', sections: [{ heading: 'Plan' }],
    })).toEqual({
      card: 'generic', title: 'Create Word document', kind: 'edit', locations: [{ path: 'plan.docx' }],
    })
    expect(ctx.tools.get('create_presentation')?.presentCall?.({
      output_path: 'slides.pptx', title: 'Slides', slides: [{ kind: 'title', title: 'Slides' }],
    })).toEqual({
      card: 'generic', title: 'Create PowerPoint presentation', kind: 'edit', locations: [{ path: 'slides.pptx' }],
    })
    expect(ctx.tools.get('create_spreadsheet')?.presentCall?.({
      output_path: 'scores.xlsx', sheets: [{ name: 'Scores', rows: [] }],
    })).toEqual({
      card: 'generic', title: 'Create Excel workbook', kind: 'edit', locations: [{ path: 'scores.xlsx' }],
    })

    const word = await ctx.tools.execute({
      signal, agent, callId: ToolCallId('optional-word'), name: 'create_word_document',
      arguments: {
        output_path: 'optional.docx', overwrite: false, title: 'Lesson', subtitle: 'Grade 5', author: 'Teacher',
        sections: [{ heading: 'Plan' }],
      },
    })
    expect(word.isError).toBe(false)
    const presentation = await ctx.tools.execute({
      signal, agent, callId: ToolCallId('optional-presentation'), name: 'create_presentation',
      arguments: {
        output_path: 'optional.pptx', overwrite: false, title: 'Lesson', author: 'Teacher',
        slides: [{ kind: 'title', title: 'Lesson' }],
      },
    })
    expect(presentation.isError).toBe(false)
    const spreadsheet = await ctx.tools.execute({
      signal, agent, callId: ToolCallId('optional-spreadsheet'), name: 'create_spreadsheet',
      arguments: {
        output_path: 'optional.xlsx', overwrite: false, title: 'Scores', author: 'Teacher',
        sheets: [{
          name: 'Scores', columns: ['Score'], rows: [[100]], freezeHeader: true, autoFilter: true,
          formulas: [{ cell: 'B2', formula: 'A2', result: 100 }],
          numberFormats: [{ range: 'A2:B2', format: '0' }],
        }],
      },
    })
    expect(spreadsheet.isError).toBe(false)
    await expect(readFile(join(root, 'optional.docx'))).resolves.toBeInstanceOf(Buffer)
  })
})
