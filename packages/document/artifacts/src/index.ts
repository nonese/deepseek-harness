/**
 * Service Definition for creating Office Open XML artifacts inside one agent workspace.
 * Providers own file generation, validation, and atomic publication; tool consumers own
 * model-facing schemas and always supply the calling session's workspace root.
 * @module @deepseek-ai/dsh-artifacts
 */

import { Context, Service } from '@deepseek-ai/cordis'

/** Supported Office Open XML artifact families. */
export type DocumentArtifactKind = 'docx' | 'pptx' | 'xlsx'

/** Scalar spreadsheet cell value accepted by the workbook generator. */
export type SpreadsheetScalar = string | number | boolean | null

/** A table embedded in a Word section. */
export interface WordTable {
  /** Column labels in display order. */
  headers: string[]
  /** Body rows; each row is padded or truncated to the header count. */
  rows: string[][]
}

/** One titled part of a Word document. */
export interface WordSection {
  /** Section heading. */
  heading: string
  /** Heading depth. Defaults to level 1. */
  level?: 1 | 2
  /** Body paragraphs in reading order. */
  paragraphs?: string[]
  /** Bulleted items following the paragraphs. */
  bullets?: string[]
  /** Optional table following the text. */
  table?: WordTable
}

/** Request for one styled Word document. */
export interface WordDocumentRequest {
  /** Absolute workspace root supplied by the trusted consumer. */
  cwd: string
  /** Relative `.docx` output path below `cwd`. */
  outputPath: string
  /** Replace an existing regular file at the same path. */
  overwrite?: boolean
  /** Document title. */
  title: string
  /** Optional subtitle below the title. */
  subtitle?: string
  /** Optional author stored in document properties. */
  author?: string
  /** Ordered document sections. */
  sections: WordSection[]
}

/** Supported presentation slide layouts. */
export type PresentationSlideKind = 'title' | 'section' | 'content' | 'two-column'

/** One presentation slide. */
export interface PresentationSlide {
  /** Layout used to place the supplied content. */
  kind: PresentationSlideKind
  /** Slide title. */
  title: string
  /** Subtitle for title or section slides. */
  subtitle?: string
  /** Bullets for a content slide. */
  bullets?: string[]
  /** Left-column bullets for a two-column slide. */
  left?: string[]
  /** Right-column bullets for a two-column slide. */
  right?: string[]
  /** Speaker notes stored with the slide. */
  speakerNotes?: string
}

/** Request for one widescreen PowerPoint deck. */
export interface PresentationRequest {
  /** Absolute workspace root supplied by the trusted consumer. */
  cwd: string
  /** Relative `.pptx` output path below `cwd`. */
  outputPath: string
  /** Replace an existing regular file at the same path. */
  overwrite?: boolean
  /** Presentation title stored in document properties. */
  title: string
  /** Optional author stored in document properties. */
  author?: string
  /** Ordered slides. */
  slides: PresentationSlide[]
}

/** Formula assignment applied after spreadsheet rows are populated. */
export interface SpreadsheetFormula {
  /** A1-style target cell reference. */
  cell: string
  /** Excel formula without the leading equals sign. */
  formula: string
  /** Cached result shown by readers that do not recalculate immediately. */
  result?: Exclude<SpreadsheetScalar, null>
}

/** Number format applied to an A1-style cell or range. */
export interface SpreadsheetNumberFormat {
  /** A1-style cell or range. */
  range: string
  /** Excel number-format code. */
  format: string
}

/** One worksheet in a generated workbook. */
export interface SpreadsheetSheet {
  /** Worksheet name. */
  name: string
  /** Optional header row. */
  columns?: string[]
  /** Body rows. */
  rows: SpreadsheetScalar[][]
  /** Keep the header row visible while scrolling. */
  freezeHeader?: boolean
  /** Enable filtering on the populated header and data range. */
  autoFilter?: boolean
  /** Formula assignments applied after rows. */
  formulas?: SpreadsheetFormula[]
  /** Number formats applied after formulas. */
  numberFormats?: SpreadsheetNumberFormat[]
}

/** Request for one styled Excel workbook. */
export interface SpreadsheetRequest {
  /** Absolute workspace root supplied by the trusted consumer. */
  cwd: string
  /** Relative `.xlsx` output path below `cwd`. */
  outputPath: string
  /** Replace an existing regular file at the same path. */
  overwrite?: boolean
  /** Optional workbook title stored in document properties. */
  title?: string
  /** Optional author stored in document properties. */
  author?: string
  /** Ordered worksheets. */
  sheets: SpreadsheetSheet[]
}

/** Canonical result returned by every document-artifact operation. */
export interface DocumentArtifactResult {
  /** Created Office Open XML family. */
  kind: DocumentArtifactKind
  /** Workspace-relative output path. */
  path: string
  /** Published file size. */
  sizeBytes: number
  /** Number of Word sections, PowerPoint slides, or Excel worksheets. */
  itemCount: number
  /** Structural validation completed before publication. */
  validation: 'ooxml'
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    documentArtifacts: DocumentArtifactRuntime
  }
}

/**
 * Office artifact generation service. Implementations must keep `outputPath` below `cwd`,
 * reject symbolic-link escapes, validate the generated OOXML archive, and publish atomically.
 */
export abstract class DocumentArtifactRuntime extends Service {
  constructor(ctx: Context) {
    super(ctx, 'documentArtifacts')
  }

  /**
   * Create a Word document.
   * @param request - trusted workspace root plus model-authored document content.
   * @param signal - aborts before publication.
   * @returns the published artifact metadata.
   */
  abstract createWord(request: WordDocumentRequest, signal?: AbortSignal): Promise<DocumentArtifactResult>

  /**
   * Create a PowerPoint presentation.
   * @param request - trusted workspace root plus model-authored slide content.
   * @param signal - aborts before publication.
   * @returns the published artifact metadata.
   */
  abstract createPresentation(request: PresentationRequest, signal?: AbortSignal): Promise<DocumentArtifactResult>

  /**
   * Create an Excel workbook.
   * @param request - trusted workspace root plus model-authored workbook content.
   * @param signal - aborts before publication.
   * @returns the published artifact metadata.
   */
  abstract createSpreadsheet(request: SpreadsheetRequest, signal?: AbortSignal): Promise<DocumentArtifactResult>
}

export default DocumentArtifactRuntime
