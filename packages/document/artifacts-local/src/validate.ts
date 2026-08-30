/** Structural validation of generated Office Open XML archives. */

import JSZip from 'jszip'
import type { DocumentArtifactKind } from '@deepseek-ai/dsh-artifacts'

const REQUIRED_PARTS: Readonly<Record<DocumentArtifactKind, readonly string[]>> = {
  docx: ['[Content_Types].xml', 'word/document.xml'],
  pptx: ['[Content_Types].xml', 'ppt/presentation.xml'],
  xlsx: ['[Content_Types].xml', 'xl/workbook.xml'],
}

/**
 * Reject archives that cannot be opened or omit the OOXML parts needed by their artifact family.
 * @param bytes - generated archive bytes.
 * @param kind - expected artifact family.
 * @param itemCount - expected section, slide, or worksheet count.
 */
export async function validateOoxml(
  bytes: Uint8Array,
  kind: DocumentArtifactKind,
  itemCount: number,
): Promise<void> {
  const archive = await JSZip.loadAsync(bytes)
  for (const part of REQUIRED_PARTS[kind]) {
    const entry = archive.file(part)
    if (entry === null || (await entry.async('uint8array')).byteLength === 0) {
      throw new Error(`generated ${kind} archive is missing required part ${part}`)
    }
  }
  if (kind === 'pptx') {
    const slides = Object.keys(archive.files).filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    if (slides.length !== itemCount) {
      throw new Error(`generated pptx contains ${String(slides.length)} slides; expected ${String(itemCount)}`)
    }
  }
  if (kind === 'xlsx') {
    const sheets = Object.keys(archive.files).filter(path => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
    if (sheets.length !== itemCount) {
      throw new Error(`generated xlsx contains ${String(sheets.length)} worksheets; expected ${String(itemCount)}`)
    }
  }
}
