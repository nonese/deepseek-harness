/** Styled Excel workbook generation. */

import ExcelJS from 'exceljs'
import type {
  SpreadsheetNumberFormat,
  SpreadsheetRequest,
  SpreadsheetScalar,
} from '@deepseek-ai/dsh-artifacts'

function columnLetter(index: number): string {
  let value = index
  let result = ''
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26)
  }
  return result
}

function columnIndex(value: string): number {
  let result = 0
  for (const character of value) result = result * 26 + character.charCodeAt(0) - 64
  return result
}

function applyNumberFormat(worksheet: ExcelJS.Worksheet, item: SpreadsheetNumberFormat): void {
  const parts = item.range.toUpperCase().split(':')
  const from = parts[0] as string
  const to = parts[1] ?? from
  const start = /^([A-Z]+)(\d+)$/.exec(from)
  const end = /^([A-Z]+)(\d+)$/.exec(to)
  if (start === null || end === null) throw new Error(`invalid spreadsheet number format range ${item.range}`)
  const fromColumn = columnIndex(start[1] as string)
  const toColumn = columnIndex(end[1] as string)
  const fromRow = Number(start[2])
  const toRow = Number(end[2])
  if (fromColumn > toColumn || fromRow > toRow) throw new Error(`invalid spreadsheet number format range ${item.range}`)
  for (let row = fromRow; row <= toRow; row++) {
    for (let column = fromColumn; column <= toColumn; column++) {
      worksheet.getCell(row, column).numFmt = item.format
    }
  }
}

function widthOf(values: readonly SpreadsheetScalar[]): number {
  let longest = 0
  for (const value of values) longest = Math.max(longest, String(value ?? '').length)
  return Math.min(36, Math.max(10, longest + 2))
}

/**
 * Render a spreadsheet request to a complete OOXML archive.
 * @param request - validated workbook request.
 * @param font - configured workbook font.
 * @param accent - configured six-digit accent color.
 * @returns generated `.xlsx` bytes.
 */
export async function renderSpreadsheet(
  request: SpreadsheetRequest,
  font: string,
  accent: string,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = request.author ?? 'Harness'
  workbook.lastModifiedBy = request.author ?? 'Harness'
  workbook.created = new Date()
  workbook.modified = new Date()
  workbook.title = request.title ?? ''
  workbook.calcProperties.fullCalcOnLoad = true

  for (const item of request.sheets) {
    const worksheet = workbook.addWorksheet(item.name, {
      views: item.freezeHeader ? [{ state: 'frozen', ySplit: 1 }] : [],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    })
    if (item.columns !== undefined) {
      const header = worksheet.addRow(item.columns)
      header.font = { name: font, bold: true, color: { argb: 'FFFFFFFF' } }
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${accent}` } }
      header.alignment = { vertical: 'middle', horizontal: 'center' }
      header.height = 24
    }
    for (const row of item.rows) worksheet.addRow(row)
    const columnCount = Math.max(item.columns?.length ?? 0, ...item.rows.map(row => row.length))
    for (let column = 1; column <= columnCount; column++) {
      const values = [item.columns?.[column - 1] ?? null, ...item.rows.map(row => row[column - 1] ?? null)]
      worksheet.getColumn(column).width = widthOf(values)
      worksheet.getColumn(column).font = { name: font, size: 11 }
      worksheet.getColumn(column).alignment = { vertical: 'middle', wrapText: true }
    }
    if (item.autoFilter && item.columns !== undefined && item.columns.length > 0) {
      worksheet.autoFilter = `A1:${columnLetter(item.columns.length)}${String(Math.max(1, worksheet.rowCount))}`
    }
    for (const formula of item.formulas ?? []) {
      worksheet.getCell(formula.cell).value = formula.result === undefined
        ? { formula: formula.formula }
        : { formula: formula.formula, result: formula.result }
    }
    for (const numberFormat of item.numberFormats ?? []) applyNumberFormat(worksheet, numberFormat)
  }
  const output = await workbook.xlsx.writeBuffer({ useStyles: true, useSharedStrings: true })
  return new Uint8Array(output)
}
