/** Styled widescreen PowerPoint generation. */

import PptxGenJS from 'pptxgenjs'
import type { PresentationRequest, PresentationSlide } from '@deepseek-ai/dsh-artifacts'

function lines(items: readonly string[]): string {
  return items.map(item => `•  ${item}`).join('\n')
}

function addFooter(slide: PptxGenJS.Slide, index: number, font: string, accent: string): void {
  slide.addText(String(index), {
    x: 12.35, y: 7.08, w: 0.45, h: 0.18,
    fontFace: font, fontSize: 9, color: accent, align: 'right', margin: 0,
  })
}

function addContentSlide(
  slide: PptxGenJS.Slide,
  item: PresentationSlide,
  font: string,
  accent: string,
): void {
  slide.background = { color: 'F7F9FC' }
  slide.addText(item.title, {
    x: 0.65, y: 0.45, w: 12, h: 0.55,
    fontFace: font, fontSize: 26, bold: true, color: accent, margin: 0, fit: 'shrink',
  })
  if (item.kind === 'two-column') {
    slide.addText(lines(item.left ?? []), {
      x: 0.8, y: 1.35, w: 5.6, h: 5.35,
      fontFace: font, fontSize: 20, color: '1F2933', breakLine: false,
      margin: 0.12, valign: 'top', fit: 'shrink', paraSpaceAfter: 12,
    })
    slide.addText(lines(item.right ?? []), {
      x: 6.9, y: 1.35, w: 5.6, h: 5.35,
      fontFace: font, fontSize: 20, color: '1F2933', breakLine: false,
      margin: 0.12, valign: 'top', fit: 'shrink', paraSpaceAfter: 12,
    })
  } else {
    slide.addText(lines(item.bullets ?? []), {
      x: 0.9, y: 1.35, w: 11.5, h: 5.35,
      fontFace: font, fontSize: 22, color: '1F2933', breakLine: false,
      margin: 0.12, valign: 'top', fit: 'shrink', paraSpaceAfter: 14,
    })
  }
}

/**
 * Render a presentation request to a complete OOXML archive.
 * @param request - validated presentation request.
 * @param font - configured presentation font.
 * @param accent - configured six-digit accent color.
 * @returns generated `.pptx` bytes.
 */
export async function renderPresentation(
  request: PresentationRequest,
  font: string,
  accent: string,
): Promise<Uint8Array> {
  const presentation = new PptxGenJS()
  presentation.layout = 'LAYOUT_WIDE'
  presentation.author = request.author ?? 'Harness'
  presentation.company = 'Harness'
  presentation.subject = request.title
  presentation.title = request.title
  presentation.theme = { headFontFace: font, bodyFontFace: font }

  request.slides.forEach((item, index) => {
    const slide = presentation.addSlide()
    if (item.kind === 'title') {
      slide.background = { color: accent }
      slide.addText(item.title, {
        x: 0.9, y: 2.1, w: 11.5, h: 1.35,
        fontFace: font, fontSize: 36, bold: true, color: 'FFFFFF',
        align: 'center', valign: 'middle', margin: 0, fit: 'shrink',
      })
      if (item.subtitle !== undefined) {
        slide.addText(item.subtitle, {
          x: 1.4, y: 3.65, w: 10.5, h: 0.65,
          fontFace: font, fontSize: 20, color: 'EAF2FF', align: 'center', margin: 0, fit: 'shrink',
        })
      }
    } else if (item.kind === 'section') {
      slide.background = { color: 'EDF4FF' }
      slide.addText(item.title, {
        x: 0.9, y: 2.45, w: 11.5, h: 1.05,
        fontFace: font, fontSize: 32, bold: true, color: accent,
        align: 'center', valign: 'middle', margin: 0, fit: 'shrink',
      })
      if (item.subtitle !== undefined) {
        slide.addText(item.subtitle, {
          x: 1.5, y: 3.65, w: 10.3, h: 0.6,
          fontFace: font, fontSize: 18, color: '52606D', align: 'center', margin: 0, fit: 'shrink',
        })
      }
    } else {
      addContentSlide(slide, item, font, accent)
    }
    if (item.speakerNotes !== undefined) slide.addNotes(item.speakerNotes)
    addFooter(slide, index + 1, font, item.kind === 'title' ? 'FFFFFF' : accent)
  })
  const output = await presentation.write({ outputType: 'nodebuffer' })
  /* v8 ignore next 4 -- nodebuffer always returns Uint8Array; this block narrows the library's broader output union. */
  if (!(output instanceof Uint8Array)) {
    if (output instanceof ArrayBuffer) return new Uint8Array(output)
    throw new Error('PowerPoint generator returned an unsupported binary output')
  }
  return output
}
