/** Local OOXML provider for Word, PowerPoint, and Excel artifact generation. @module @deepseek-ai/dsh-artifacts-local */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DocumentArtifactRuntime } from '@deepseek-ai/dsh-artifacts'
import type {
  DocumentArtifactResult,
  PresentationRequest,
  SpreadsheetRequest,
  WordDocumentRequest,
} from '@deepseek-ai/dsh-artifacts'
import { artifactTarget, publishArtifact } from './path.ts'
import { renderPresentation } from './presentation.ts'
import { renderSpreadsheet } from './spreadsheet.ts'
import { validateOoxml } from './validate.ts'
import { renderWord } from './word.ts'

/** Local document generator limits and visual defaults. */
export interface Config {
  /** Maximum Word sections. Defaults to 64. */
  maxWordSections?: number
  /** Maximum presentation slides. Defaults to 80. */
  maxPresentationSlides?: number
  /** Maximum workbook worksheets. Defaults to 20. */
  maxSpreadsheetSheets?: number
  /** Maximum rows in one worksheet. Defaults to 10,000. */
  maxSpreadsheetRowsPerSheet?: number
  /** Maximum cells across one workbook. Defaults to 100,000. */
  maxSpreadsheetCells?: number
  /** Maximum text characters across one request. Defaults to 1,000,000. */
  maxTextChars?: number
  /** Maximum generated archive size. Defaults to 100 MiB. */
  maxOutputBytes?: number
  /** Font used across generated artifacts. Defaults to Aptos. */
  fontFamily?: string
  /** Six-digit hexadecimal accent color. Defaults to 2F6FEB. */
  accentColor?: string
}

type ResolvedConfig = Required<Config>

/** Runtime schema for local document generation. */
export const Config: z<Config> = z.object({
  maxWordSections: z.natural().min(1).max(1_000).default(64),
  maxPresentationSlides: z.natural().min(1).max(1_000).default(80),
  maxSpreadsheetSheets: z.natural().min(1).max(200).default(20),
  maxSpreadsheetRowsPerSheet: z.natural().min(1).max(1_000_000).default(10_000),
  maxSpreadsheetCells: z.natural().min(1).max(10_000_000).default(100_000),
  maxTextChars: z.natural().min(1).max(100_000_000).default(1_000_000),
  maxOutputBytes: z.natural().min(1_024).max(1024 * 1024 * 1024).default(100 * 1024 * 1024),
  fontFamily: z.string().default('Aptos'),
  accentColor: z.string().default('2F6FEB'),
})

function characterCount(value: unknown): number {
  if (typeof value === 'string') return value.length
  if (Array.isArray(value)) {
    let total = 0
    for (const item of value as unknown[]) total += characterCount(item)
    return total
  }
  if (typeof value === 'object' && value !== null) {
    let total = 0
    for (const item of Object.values(value as Readonly<Record<string, unknown>>)) total += characterCount(item)
    return total
  }
  return 0
}

function nonEmpty(label: string, value: string): void {
  if (value.trim().length === 0) throw new Error(`${label} must be a non-empty string`)
}

/** Host-filesystem OOXML provider with workspace confinement and atomic publication. */
export class LocalDocumentArtifactRuntime extends DocumentArtifactRuntime {
  static Config = Config

  private readonly config: ResolvedConfig

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.config = config as ResolvedConfig
    if (!/^[0-9A-Fa-f]{6}$/.test(this.config.accentColor)) {
      throw new Error('document-artifacts-local: accentColor must contain six hexadecimal digits')
    }
    nonEmpty('document-artifacts-local: fontFamily', this.config.fontFamily)
  }

  private validateText(request: unknown): void {
    const count = characterCount(request)
    if (count > this.config.maxTextChars) {
      throw new Error(`document artifact text exceeds the configured ${String(this.config.maxTextChars)} character limit`)
    }
  }

  private async finish(
    request: { cwd: string; outputPath: string; overwrite?: boolean },
    kind: 'docx' | 'pptx' | 'xlsx',
    itemCount: number,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<DocumentArtifactResult> {
    if (bytes.byteLength > this.config.maxOutputBytes) {
      throw new Error(`generated ${kind} exceeds the configured ${String(this.config.maxOutputBytes)} byte limit`)
    }
    await validateOoxml(bytes, kind, itemCount)
    const overwrite = request.overwrite ?? false
    const target = await artifactTarget(request.cwd, request.outputPath, `.${kind}`, overwrite)
    await publishArtifact(target, bytes, overwrite, signal)
    return {
      kind,
      path: target.relativePath,
      sizeBytes: bytes.byteLength,
      itemCount,
      validation: 'ooxml',
    }
  }

  override async createWord(request: WordDocumentRequest, signal?: AbortSignal): Promise<DocumentArtifactResult> {
    nonEmpty('word title', request.title)
    if (request.sections.length === 0 || request.sections.length > this.config.maxWordSections) {
      throw new Error(`word sections must contain 1–${String(this.config.maxWordSections)} items`)
    }
    for (const section of request.sections) {
      nonEmpty('word section heading', section.heading)
      if (section.table !== undefined && section.table.headers.length === 0) {
        throw new Error('word table headers must not be empty')
      }
    }
    this.validateText(request)
    const bytes = await renderWord(request, this.config.fontFamily, this.config.accentColor.toUpperCase())
    return this.finish(request, 'docx', request.sections.length, bytes, signal)
  }

  override async createPresentation(request: PresentationRequest, signal?: AbortSignal): Promise<DocumentArtifactResult> {
    nonEmpty('presentation title', request.title)
    if (request.slides.length === 0 || request.slides.length > this.config.maxPresentationSlides) {
      throw new Error(`presentation slides must contain 1–${String(this.config.maxPresentationSlides)} items`)
    }
    for (const slide of request.slides) nonEmpty('presentation slide title', slide.title)
    this.validateText(request)
    const bytes = await renderPresentation(request, this.config.fontFamily, this.config.accentColor.toUpperCase())
    return this.finish(request, 'pptx', request.slides.length, bytes, signal)
  }

  override async createSpreadsheet(request: SpreadsheetRequest, signal?: AbortSignal): Promise<DocumentArtifactResult> {
    if (request.sheets.length === 0 || request.sheets.length > this.config.maxSpreadsheetSheets) {
      throw new Error(`spreadsheet sheets must contain 1–${String(this.config.maxSpreadsheetSheets)} items`)
    }
    const names = new Set<string>()
    let cells = 0
    for (const sheet of request.sheets) {
      nonEmpty('spreadsheet sheet name', sheet.name)
      if (sheet.name.length > 31 || /[\\/*?:\[\]]/.test(sheet.name)) throw new Error(`invalid spreadsheet sheet name ${sheet.name}`)
      const normalized = sheet.name.toLocaleLowerCase('en-US')
      if (names.has(normalized)) throw new Error(`duplicate spreadsheet sheet name ${sheet.name}`)
      names.add(normalized)
      if (sheet.rows.length > this.config.maxSpreadsheetRowsPerSheet) {
        throw new Error(`spreadsheet sheet ${sheet.name} exceeds the configured row limit`)
      }
      cells += (sheet.columns?.length ?? 0) + sheet.rows.reduce((total, row) => total + row.length, 0)
    }
    if (cells > this.config.maxSpreadsheetCells) {
      throw new Error(`spreadsheet exceeds the configured ${String(this.config.maxSpreadsheetCells)} cell limit`)
    }
    this.validateText(request)
    const bytes = await renderSpreadsheet(request, this.config.fontFamily, this.config.accentColor.toUpperCase())
    return this.finish(request, 'xlsx', request.sheets.length, bytes, signal)
  }
}

export default LocalDocumentArtifactRuntime
