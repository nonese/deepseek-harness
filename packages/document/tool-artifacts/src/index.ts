/** Model-facing Word, PowerPoint, and Excel creation tools. @module @deepseek-ai/dsh-tool-artifacts */

import type { Context } from '@deepseek-ai/cordis'
import type {
  PresentationRequest,
  SpreadsheetRequest,
  WordDocumentRequest,
} from '@deepseek-ai/dsh-artifacts'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'tool-document-artifacts'
/** Required document runtime and tool registry. */
export const inject = ['documentArtifacts', 'tools']

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, enum: ['docx', 'pptx', 'xlsx'] },
    path: { type: 'string', required: true },
    sizeBytes: { type: 'integer', required: true },
    itemCount: { type: 'integer', required: true },
    validation: { type: 'string', required: true, const: 'ooxml' },
  },
} as const

const STRING_ARRAY = { type: 'array', items: { type: 'string' } } as const
const SCALAR = {
  oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }],
} as const
const FORMULA_RESULT = {
  oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
} as const

function workspaceCwd(exec: ToolExecution): string {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined || cwd.length === 0) {
    throw new Error('document creation requires a session workspace')
  }
  return cwd
}

function renderResult(value: { kind: string; path: string; sizeBytes: number; itemCount: number }) {
  return [{
    type: 'text' as const,
    text: `Created ${value.kind.toUpperCase()} ${value.path} (${String(value.sizeBytes)} bytes; ${String(value.itemCount)} items).`,
  }]
}

/** Register the three document-creation tools. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'create_word_document',
    description: 'Create a styled Word document in the current project. Use it for lesson plans, handouts, reports, rubrics, and structured teaching documents. The output path must be relative and end with .docx.',
    parameters: {
      output_path: { type: 'string', required: true, description: 'Project-relative .docx path.' },
      overwrite: { type: 'boolean', description: 'Replace an existing regular file at the same path.' },
      title: { type: 'string', required: true },
      subtitle: { type: 'string' },
      author: { type: 'string' },
      sections: {
        type: 'array', required: true,
        description: 'Ordered document sections.',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            heading: { type: 'string', required: true },
            level: { type: 'integer', enum: [1, 2] },
            paragraphs: STRING_ARRAY,
            bullets: STRING_ARRAY,
            table: {
              type: 'object', additionalProperties: false,
              properties: {
                headers: { type: 'array', required: true, items: { type: 'string' } },
                rows: {
                  type: 'array', required: true,
                  items: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    output: { schema: OUTPUT_SCHEMA, render: (_args, value) => renderResult(value) },
    presentCall: args => ({
      card: 'generic', title: 'Create Word document', kind: 'edit',
      locations: [{ path: args.output_path }],
    }),
    async execute(args, exec) {
      const request: WordDocumentRequest = {
        cwd: workspaceCwd(exec),
        outputPath: args.output_path,
        ...(args.overwrite === undefined ? {} : { overwrite: args.overwrite }),
        title: args.title,
        ...(args.subtitle === undefined ? {} : { subtitle: args.subtitle }),
        ...(args.author === undefined ? {} : { author: args.author }),
        sections: args.sections,
      }
      return ctx.documentArtifacts.createWord(request, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'create_presentation',
    description: 'Create a clear widescreen PowerPoint deck in the current project. Use concise slide titles, keep content slides focused, and use two-column slides only for genuine comparisons. The output path must end with .pptx.',
    parameters: {
      output_path: { type: 'string', required: true, description: 'Project-relative .pptx path.' },
      overwrite: { type: 'boolean', description: 'Replace an existing regular file at the same path.' },
      title: { type: 'string', required: true },
      author: { type: 'string' },
      slides: {
        type: 'array', required: true,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, enum: ['title', 'section', 'content', 'two-column'] },
            title: { type: 'string', required: true },
            subtitle: { type: 'string' },
            bullets: STRING_ARRAY,
            left: STRING_ARRAY,
            right: STRING_ARRAY,
            speakerNotes: { type: 'string' },
          },
        },
      },
    },
    output: { schema: OUTPUT_SCHEMA, render: (_args, value) => renderResult(value) },
    presentCall: args => ({
      card: 'generic', title: 'Create PowerPoint presentation', kind: 'edit',
      locations: [{ path: args.output_path }],
    }),
    async execute(args, exec) {
      const request: PresentationRequest = {
        cwd: workspaceCwd(exec),
        outputPath: args.output_path,
        ...(args.overwrite === undefined ? {} : { overwrite: args.overwrite }),
        title: args.title,
        ...(args.author === undefined ? {} : { author: args.author }),
        slides: args.slides,
      }
      return ctx.documentArtifacts.createPresentation(request, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'create_spreadsheet',
    description: 'Create a styled Excel workbook in the current project. Use it for gradebooks, schedules, assessment analysis, rosters, and structured teaching data. Prefer formulas for derived values. The output path must end with .xlsx.',
    parameters: {
      output_path: { type: 'string', required: true, description: 'Project-relative .xlsx path.' },
      overwrite: { type: 'boolean', description: 'Replace an existing regular file at the same path.' },
      title: { type: 'string' },
      author: { type: 'string' },
      sheets: {
        type: 'array', required: true,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            columns: STRING_ARRAY,
            rows: {
              type: 'array', required: true,
              items: { type: 'array', items: SCALAR },
            },
            freezeHeader: { type: 'boolean' },
            autoFilter: { type: 'boolean' },
            formulas: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false,
                properties: {
                  cell: { type: 'string', required: true },
                  formula: { type: 'string', required: true },
                  result: FORMULA_RESULT,
                },
              },
            },
            numberFormats: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false,
                properties: {
                  range: { type: 'string', required: true },
                  format: { type: 'string', required: true },
                },
              },
            },
          },
        },
      },
    },
    output: { schema: OUTPUT_SCHEMA, render: (_args, value) => renderResult(value) },
    presentCall: args => ({
      card: 'generic', title: 'Create Excel workbook', kind: 'edit',
      locations: [{ path: args.output_path }],
    }),
    async execute(args, exec) {
      const request: SpreadsheetRequest = {
        cwd: workspaceCwd(exec),
        outputPath: args.output_path,
        ...(args.overwrite === undefined ? {} : { overwrite: args.overwrite }),
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.author === undefined ? {} : { author: args.author }),
        sheets: args.sheets,
      }
      return ctx.documentArtifacts.createSpreadsheet(request, exec.signal)
    },
  }))
}
