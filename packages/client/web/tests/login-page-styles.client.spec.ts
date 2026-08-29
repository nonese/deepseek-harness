/** The pre-authentication shell renders before the dynamic theme plugin. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const loginCss = readFileSync(fileURLToPath(new URL('../src/LoginPage.module.css', import.meta.url)), 'utf8')

describe('login page styles', () => {
  it('provides fallbacks for theme-owned colors and elevation', () => {
    expect(loginCss).not.toMatch(/var\(--dsw-(?:specific-login-[\w-]+|shadow-lv3)\)/)
    expect(loginCss).toContain('rgba(255, 255, 255, 0.96)')
    expect(loginCss).toContain('background: var(--dsw-specific-login-primary, #4176e6)')
    expect(loginCss).toContain('background: var(--dsw-specific-login-input, #fff)')
    expect(loginCss).toContain('border: 2px solid var(--dsw-specific-login-border')
  })
})
