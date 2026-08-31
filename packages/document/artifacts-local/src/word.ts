/** Styled Word document generation. */

import type { Paragraph, Table, TableRow } from 'docx'
import type { WordDocumentRequest } from '@deepseek-ai/dsh-artifacts'

function tableOf(docx: typeof import('docx'), headers: string[], rows: string[][], font: string): Table {
  const { BorderStyle, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } = docx
  const border = { style: BorderStyle.SINGLE, size: 1, color: 'D8DEE9' } as const
  const width = headers.length
  const rowOf = (values: string[], header: boolean): TableRow => new TableRow({
    children: Array.from({ length: width }, (_, index) => new TableCell({
      children: [new Paragraph({
        children: [new TextRun({ text: values[index] ?? '', bold: header, font, size: 20 })],
      })],
      borders: { top: border, bottom: border, left: border, right: border },
      width: { size: Math.floor(100 / width), type: WidthType.PERCENTAGE },
    })),
  })
  return new Table({
    rows: [rowOf(headers, true), ...rows.map(row => rowOf(row.slice(0, width), false))],
    width: { size: 100, type: WidthType.PERCENTAGE },
  })
}

/**
 * Render a Word request to a complete OOXML archive.
 * @param request - validated document request.
 * @param font - configured document font.
 * @param accent - configured six-digit accent color.
 * @returns generated `.docx` bytes.
 */
export async function renderWord(
  request: WordDocumentRequest,
  font: string,
  accent: string,
): Promise<Uint8Array> {
  const docx = await import('docx')
  const { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } = docx
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
      children: [new TextRun({ text: request.title, bold: true, color: accent, font, size: 38 })],
    }),
  ]
  if (request.subtitle !== undefined) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: [new TextRun({ text: request.subtitle, color: '52606D', font, size: 22 })],
    }))
  }
  for (const section of request.sections) {
    children.push(new Paragraph({
      heading: section.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1,
      spacing: { before: 260, after: 120 },
      children: [new TextRun({ text: section.heading, color: accent, font })],
    }))
    for (const paragraph of section.paragraphs ?? []) {
      children.push(new Paragraph({
        spacing: { after: 120, line: 360 },
        children: [new TextRun({ text: paragraph, font, size: 22 })],
      }))
    }
    for (const bullet of section.bullets ?? []) {
      children.push(new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 80, line: 320 },
        children: [new TextRun({ text: bullet, font, size: 22 })],
      }))
    }
    if (section.table !== undefined) children.push(tableOf(docx, section.table.headers, section.table.rows, font))
  }
  const document = new Document({
    creator: request.author ?? 'Harness',
    title: request.title,
    description: request.subtitle ?? '',
    sections: [{
      properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
      children,
    }],
  })
  return Packer.toBuffer(document)
}
