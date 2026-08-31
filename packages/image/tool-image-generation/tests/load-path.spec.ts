/**
 * Loader export-shape guard for the image-generation tool namespace. A default
 * export would make Loader unwrap the module to `apply` and discard `inject`,
 * so the Product Design preset would fail before registering either tool.
 */

import { describe, expect, it } from 'vitest'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as ToolImageGeneration from '@deepseek-ai/dsh-tool-image-generation'

describe('dsh-tool-image-generation Loader export shape', () => {
  it('keeps the namespace metadata through Loader unwrapping', () => {
    expect('default' in ToolImageGeneration).toBe(false)

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(ToolImageGeneration) as Record<string, unknown>
    expect(unwrapped).toBe(ToolImageGeneration)
    expect(unwrapped.name).toBe('tool-image-generation')
    expect(unwrapped.inject).toEqual(['attachments', 'imageGeneration', 'llm', 'tools'])
    expect(typeof unwrapped.apply).toBe('function')
  })
})
