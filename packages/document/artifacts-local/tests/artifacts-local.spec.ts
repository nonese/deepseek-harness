import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import LocalDocumentArtifactRuntime from '@deepseek-ai/dsh-artifacts-local'
import type { Config as ArtifactConfig } from '@deepseek-ai/dsh-artifacts-local'
import { artifactTarget, publishArtifact } from '../src/path.ts'
import { validateOoxml } from '../src/validate.ts'

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-document-artifacts-'))
  roots.push(root)
  await mkdir(join(root, 'materials'))
  return root
}

async function runtime(config: ArtifactConfig = {}) {
  const ctx = new Context()
  const fiber = await ctx.plugin(LocalDocumentArtifactRuntime, config)
  return { ctx, fiber }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('LocalDocumentArtifactRuntime', () => {
  it('creates structurally valid Word, PowerPoint, and Excel artifacts', async () => {
    const root = await workspace()
    const { ctx, fiber } = await runtime()

    const word = await ctx.documentArtifacts.createWord({
      cwd: root,
      outputPath: 'materials/lesson-plan.docx',
      title: 'Water Cycle Lesson',
      subtitle: 'Grade 5',
      sections: [{
        heading: 'Objectives',
        paragraphs: ['Explain evaporation and condensation.'],
        bullets: ['Observe', 'Describe'],
        table: { headers: ['Stage', 'Evidence'], rows: [['Opening']] },
      }],
    })
    expect(word).toMatchObject({ kind: 'docx', path: 'materials/lesson-plan.docx', itemCount: 1, validation: 'ooxml' })
    const wordZip = await JSZip.loadAsync(await readFile(join(root, word.path)))
    await expect(wordZip.file('word/document.xml')?.async('text')).resolves.toContain('Water Cycle Lesson')

    const presentation = await ctx.documentArtifacts.createPresentation({
      cwd: root,
      outputPath: 'materials/water-cycle.pptx',
      title: 'Water Cycle',
      slides: [
        { kind: 'title', title: 'Water Cycle', subtitle: 'Observe and explain', speakerNotes: 'Introduce the driving question.' },
        { kind: 'title', title: 'Question' },
        { kind: 'content', title: 'Key stages', bullets: ['Evaporation', 'Condensation', 'Precipitation'] },
        { kind: 'section', title: 'Explore', subtitle: 'Observe a model' },
        { kind: 'section', title: 'Explain' },
        { kind: 'content', title: 'Reflect' },
        { kind: 'two-column', title: 'Compare', left: ['Liquid'], right: ['Gas'] },
        { kind: 'two-column', title: 'Recall' },
      ],
    })
    expect(presentation).toMatchObject({ kind: 'pptx', path: 'materials/water-cycle.pptx', itemCount: 8, validation: 'ooxml' })
    const presentationZip = await JSZip.loadAsync(await readFile(join(root, presentation.path)))
    await expect(presentationZip.file('ppt/slides/slide3.xml')?.async('text')).resolves.toContain('Key stages')
    await expect(presentationZip.file('ppt/notesSlides/notesSlide1.xml')?.async('text')).resolves.toContain('Introduce the driving question.')

    const spreadsheet = await ctx.documentArtifacts.createSpreadsheet({
      cwd: root,
      outputPath: 'materials/gradebook.xlsx',
      title: 'Gradebook',
      sheets: [{
        name: 'Scores',
        columns: ['Student', 'Quiz 1', 'Quiz 2', 'Average'],
        rows: [['Ada', 90, 96, null]],
        freezeHeader: true,
        autoFilter: true,
        formulas: [{ cell: 'D2', formula: 'AVERAGE(B2:C2)', result: 93 }],
        numberFormats: [{ range: 'D2', format: '0.0' }],
      }],
    })
    expect(spreadsheet).toMatchObject({ kind: 'xlsx', path: 'materials/gradebook.xlsx', itemCount: 1, validation: 'ooxml' })
    const workbook = new ExcelJS.Workbook()
    // ExcelJS's declaration bundles an older Buffer face than current Node;
    // runtime load accepts the same Uint8Array bytes that writeBuffer returns.
    const loadWorkbook = workbook.xlsx.load.bind(workbook.xlsx) as unknown as (bytes: Uint8Array) => Promise<ExcelJS.Workbook>
    await loadWorkbook(await readFile(join(root, spreadsheet.path)))
    const scores = workbook.getWorksheet('Scores')
    expect(scores?.getCell('A2').value).toBe('Ada')
    expect(scores?.getCell('D2').value).toMatchObject({ formula: 'AVERAGE(B2:C2)', result: 93 })
    expect(scores?.getCell('D2').numFmt).toBe('0.0')
    expect(scores?.views).toEqual(expect.arrayContaining([expect.objectContaining({ state: 'frozen', ySplit: 1 })]))

    await fiber.dispose()
  })

  it('confines output paths and publishes without silent replacement', async () => {
    const root = await workspace()
    const outside = await workspace()
    await symlink(outside, join(root, 'escape'))
    const { ctx, fiber } = await runtime()
    const request = {
      cwd: root,
      title: 'Lesson',
      sections: [{ heading: 'Plan', paragraphs: ['Teach.'] }],
    }

    await expect(ctx.documentArtifacts.createWord({ ...request, outputPath: '../outside.docx' }))
      .rejects.toThrow(/relative|workspace/)
    await expect(ctx.documentArtifacts.createWord({ ...request, outputPath: 'escape/outside.docx' }))
      .rejects.toThrow(/workspace/)
    await expect(lstat(join(outside, 'outside.docx'))).rejects.toMatchObject({ code: 'ENOENT' })

    await writeFile(join(root, 'materials', 'existing.docx'), 'original')
    await expect(ctx.documentArtifacts.createWord({ ...request, outputPath: 'materials/existing.docx' }))
      .rejects.toThrow(/already exists/)
    await expect(readFile(join(root, 'materials', 'existing.docx'), 'utf8')).resolves.toBe('original')

    const replaced = await ctx.documentArtifacts.createWord({
      ...request,
      outputPath: 'materials/existing.docx',
      overwrite: true,
    })
    expect(replaced.validation).toBe('ooxml')
    expect((await readFile(join(root, 'materials', 'existing.docx'))).subarray(0, 2).toString()).toBe('PK')
    await fiber.dispose()
  })

  it('rejects invalid spreadsheet names and configured limits before publication', async () => {
    const root = await workspace()
    const { ctx, fiber } = await runtime()
    await expect(ctx.documentArtifacts.createSpreadsheet({
      cwd: root,
      outputPath: 'materials/bad.xlsx',
      sheets: [{ name: 'Bad/Name', rows: [] }],
    })).rejects.toThrow(/invalid spreadsheet sheet name/)
    await expect(lstat(join(root, 'materials', 'bad.xlsx'))).rejects.toMatchObject({ code: 'ENOENT' })
    await fiber.dispose()
  })

  it('rejects invalid provider config and every request cardinality limit', async () => {
    const invalidAccent = new Context()
    await expect(invalidAccent.plugin(LocalDocumentArtifactRuntime, { accentColor: 'blue' }))
      .rejects.toThrow(/six hexadecimal digits/)
    const invalidFont = new Context()
    await expect(invalidFont.plugin(LocalDocumentArtifactRuntime, { fontFamily: ' ' }))
      .rejects.toThrow(/non-empty string/)

    const root = await workspace()
    const { ctx, fiber } = await runtime({
      maxWordSections: 1,
      maxPresentationSlides: 1,
      maxSpreadsheetSheets: 2,
      maxSpreadsheetRowsPerSheet: 1,
      maxSpreadsheetCells: 2,
    })
    const wordBase = { cwd: root, outputPath: 'materials/test.docx', title: 'Lesson' }
    await expect(ctx.documentArtifacts.createWord({ ...wordBase, title: ' ', sections: [{ heading: 'Plan' }] }))
      .rejects.toThrow(/word title/)
    await expect(ctx.documentArtifacts.createWord({ ...wordBase, sections: [] }))
      .rejects.toThrow(/word sections/)
    await expect(ctx.documentArtifacts.createWord({ ...wordBase, sections: [{ heading: 'A' }, { heading: 'B' }] }))
      .rejects.toThrow(/word sections/)
    await expect(ctx.documentArtifacts.createWord({ ...wordBase, sections: [{ heading: ' ' }] }))
      .rejects.toThrow(/section heading/)
    await expect(ctx.documentArtifacts.createWord({
      ...wordBase,
      sections: [{ heading: 'Plan', table: { headers: [], rows: [] } }],
    })).rejects.toThrow(/table headers/)

    const presentationBase = { cwd: root, outputPath: 'materials/test.pptx', title: 'Lesson' }
    await expect(ctx.documentArtifacts.createPresentation({
      ...presentationBase, title: ' ', slides: [{ kind: 'title', title: 'Lesson' }],
    })).rejects.toThrow(/presentation title/)
    await expect(ctx.documentArtifacts.createPresentation({ ...presentationBase, slides: [] }))
      .rejects.toThrow(/presentation slides/)
    await expect(ctx.documentArtifacts.createPresentation({
      ...presentationBase,
      slides: [{ kind: 'title', title: 'A' }, { kind: 'section', title: 'B' }],
    })).rejects.toThrow(/presentation slides/)
    await expect(ctx.documentArtifacts.createPresentation({
      ...presentationBase, slides: [{ kind: 'title', title: ' ' }],
    })).rejects.toThrow(/slide title/)

    const spreadsheetBase = { cwd: root, outputPath: 'materials/test.xlsx' }
    await expect(ctx.documentArtifacts.createSpreadsheet({ ...spreadsheetBase, sheets: [] }))
      .rejects.toThrow(/spreadsheet sheets/)
    await expect(ctx.documentArtifacts.createSpreadsheet({
      ...spreadsheetBase,
      sheets: [{ name: 'A', rows: [] }, { name: 'B', rows: [] }, { name: 'C', rows: [] }],
    })).rejects.toThrow(/spreadsheet sheets/)
    await expect(ctx.documentArtifacts.createSpreadsheet({
      ...spreadsheetBase, sheets: [{ name: ' ', rows: [] }],
    })).rejects.toThrow(/sheet name/)
    await expect(ctx.documentArtifacts.createSpreadsheet({
      ...spreadsheetBase, sheets: [{ name: 'x'.repeat(32), rows: [] }],
    })).rejects.toThrow(/invalid spreadsheet sheet name/)
    await expect(ctx.documentArtifacts.createSpreadsheet({
      ...spreadsheetBase, sheets: [{ name: 'Scores', rows: [] }, { name: 'scores', rows: [] }],
    })).rejects.toThrow(/duplicate spreadsheet sheet name/)
    await expect(ctx.documentArtifacts.createSpreadsheet({
      ...spreadsheetBase, sheets: [{ name: 'Scores', rows: [[1], [2]] }],
    })).rejects.toThrow(/row limit/)
    await expect(ctx.documentArtifacts.createSpreadsheet({
      ...spreadsheetBase, sheets: [{ name: 'Scores', columns: ['A', 'B'], rows: [[1]] }],
    })).rejects.toThrow(/cell limit/)
    await fiber.dispose()

    const textLimited = await runtime({ maxTextChars: 1 })
    await expect(textLimited.ctx.documentArtifacts.createWord({
      cwd: root,
      outputPath: 'materials/text.docx',
      title: 'Lesson',
      sections: [{ heading: 'Plan' }],
    })).rejects.toThrow(/character limit/)
    await textLimited.fiber.dispose()

    const outputLimited = await runtime({ maxOutputBytes: 1_024 })
    await expect(outputLimited.ctx.documentArtifacts.createWord({
      cwd: root,
      outputPath: 'materials/large.docx',
      title: 'Lesson',
      sections: [{ heading: 'Plan' }],
    })).rejects.toThrow(/exceeds.*byte limit/)
    await outputLimited.fiber.dispose()
  })

  it('renders optional Word and spreadsheet branches and rejects invalid number-format ranges', async () => {
    const root = await workspace()
    const { ctx, fiber } = await runtime()
    const word = await ctx.documentArtifacts.createWord({
      cwd: root,
      outputPath: 'materials/level-two.docx',
      title: 'Lesson',
      author: 'Teacher',
      sections: [{ heading: 'Details', level: 2 }],
    })
    expect(word.itemCount).toBe(1)

    const columns = Array.from({ length: 27 }, (_, index) => `Column ${String(index + 1)}`)
    const spreadsheet = await ctx.documentArtifacts.createSpreadsheet({
      cwd: root,
      outputPath: 'materials/options.xlsx',
      author: 'Teacher',
      sheets: [
        {
          name: 'Raw',
          rows: [['x'.repeat(80), 2]],
          formulas: [{ cell: 'C1', formula: 'SUM(A1:B1)' }],
          numberFormats: [{ range: 'Z1:AA2', format: '0.00' }],
        },
        { name: 'Wide', columns, rows: [], autoFilter: true },
      ],
    })
    expect(spreadsheet.itemCount).toBe(2)
    const workbook = new ExcelJS.Workbook()
    const loadWorkbook = workbook.xlsx.load.bind(workbook.xlsx) as unknown as (bytes: Uint8Array) => Promise<ExcelJS.Workbook>
    await loadWorkbook(await readFile(join(root, spreadsheet.path)))
    expect(workbook.getWorksheet('Raw')?.getCell('C1').value).toEqual({ formula: 'SUM(A1:B1)' })
    expect(workbook.getWorksheet('Wide')?.autoFilter).toBe('A1:AA1')
    expect(workbook.getWorksheet('Raw')?.getColumn(1).width).toBe(36)

    for (const range of ['A', 'A1:B', 'B1:A2', 'A2:B1']) {
      await expect(ctx.documentArtifacts.createSpreadsheet({
        cwd: root,
        outputPath: `materials/invalid-${range.replaceAll(':', '-')}.xlsx`,
        sheets: [{ name: 'Scores', rows: [], numberFormats: [{ range, format: '0.0' }] }],
      })).rejects.toThrow(/invalid spreadsheet number format range/)
    }
    await fiber.dispose()
  })

  it('covers direct path validation, publication races, and cancellation', async () => {
    const root = await workspace()
    const outside = await workspace()
    for (const path of ['\0bad.docx', '/tmp/bad.docx', 'C:\\bad.docx', '\\\\server\\bad.docx']) {
      await expect(artifactTarget(root, path, '.docx', false)).rejects.toThrow(/relative/)
    }
    for (const path of ['', 'materials//bad.docx', 'materials/./bad.docx', 'materials/.hidden.docx']) {
      await expect(artifactTarget(root, path, '.docx', false)).rejects.toThrow(/empty|hidden/)
    }
    await expect(artifactTarget(root, 'materials/bad.txt', '.docx', false)).rejects.toThrow(/end with/)

    await symlink(join(outside, 'missing.docx'), join(root, 'materials', 'linked.docx'))
    await expect(artifactTarget(root, 'materials/linked.docx', '.docx', true)).rejects.toThrow(/symbolic link/)
    await mkdir(join(root, 'materials', 'directory.docx'))
    await expect(artifactTarget(root, 'materials/directory.docx', '.docx', true)).rejects.toThrow(/regular file/)

    const cancelledTarget = await artifactTarget(root, 'materials/cancelled.docx', '.docx', false)
    const controller = new AbortController()
    controller.abort()
    await expect(publishArtifact(cancelledTarget, Buffer.from('data'), false, controller.signal))
      .rejects.toThrow(/aborted/)

    const conflictTarget = await artifactTarget(root, 'materials/race.docx', '.docx', false)
    await writeFile(conflictTarget.path, 'winner')
    await expect(publishArtifact(conflictTarget, Buffer.from('loser'), false)).rejects.toThrow(/already exists/)
    await expect(readFile(conflictTarget.path, 'utf8')).resolves.toBe('winner')

    const overwriteMissing = await artifactTarget(root, 'materials/new-overwrite.docx', '.docx', true)
    await publishArtifact(overwriteMissing, Buffer.from('new'), true)
    await expect(readFile(overwriteMissing.path, 'utf8')).resolves.toBe('new')

    const racedLink = await artifactTarget(root, 'materials/raced-link.docx', '.docx', true)
    await symlink(join(outside, 'target.docx'), racedLink.path)
    await expect(publishArtifact(racedLink, Buffer.from('new'), true)).rejects.toThrow(/symbolic link/)
    const racedDirectory = await artifactTarget(root, 'materials/raced-directory.docx', '.docx', true)
    await mkdir(racedDirectory.path)
    await expect(publishArtifact(racedDirectory, Buffer.from('new'), true)).rejects.toThrow(/regular file/)

    const escapedParent = await artifactTarget(root, 'materials/escaped.docx', '.docx', false)
    await rm(join(root, 'materials'), { recursive: true })
    await symlink(outside, join(root, 'materials'))
    await expect(publishArtifact(escapedParent, Buffer.from('new'), false)).rejects.toThrow(/parent left/)
  })

  it('rejects missing OOXML parts and mismatched slide or worksheet counts', async () => {
    const missing = new JSZip()
    missing.file('[Content_Types].xml', '<Types/>')
    await expect(validateOoxml(await missing.generateAsync({ type: 'uint8array' }), 'docx', 1))
      .rejects.toThrow(/missing required part word\/document\.xml/)

    const empty = new JSZip()
    empty.file('[Content_Types].xml', '')
    empty.file('word/document.xml', '<document/>')
    await expect(validateOoxml(await empty.generateAsync({ type: 'uint8array' }), 'docx', 1))
      .rejects.toThrow(/missing required part \[Content_Types\]\.xml/)

    const presentation = new JSZip()
    presentation.file('[Content_Types].xml', '<Types/>')
    presentation.file('ppt/presentation.xml', '<presentation/>')
    presentation.file('ppt/slides/slide1.xml', '<slide/>')
    await expect(validateOoxml(await presentation.generateAsync({ type: 'uint8array' }), 'pptx', 2))
      .rejects.toThrow(/contains 1 slides; expected 2/)

    const spreadsheet = new JSZip()
    spreadsheet.file('[Content_Types].xml', '<Types/>')
    spreadsheet.file('xl/workbook.xml', '<workbook/>')
    spreadsheet.file('xl/worksheets/sheet1.xml', '<worksheet/>')
    await expect(validateOoxml(await spreadsheet.generateAsync({ type: 'uint8array' }), 'xlsx', 2))
      .rejects.toThrow(/contains 1 worksheets; expected 2/)
  })
})
