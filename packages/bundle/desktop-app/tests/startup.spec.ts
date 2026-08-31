/** Desktop Web flag parsing without the server authentication provider. */

import { Context } from '@deepseek-ai/cordis'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import type { WebStartupValues } from '@deepseek-ai/dsh-web-app/startup'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, inject } from '../src/startup.ts'

afterEach(() => {
  internals.stdout = process.stdout
  internals.stderr = process.stderr
})

describe('desktop Web command provider', () => {
  it('publishes loopback launch flags without an auth service', () => {
    const ctx = new Context()
    provideCmdline(ctx, {
      args: ['--host', '127.0.0.1', '--port', '0', '--no-open'],
      exit: () => undefined,
    })

    apply(ctx)

    expect(inject).toEqual(['cmdlineArgs'])
    expect(ctx.get('webStartup') as WebStartupValues).toEqual({
      host: '127.0.0.1',
      openBrowser: false,
      port: 0,
      trustedHosts: [],
    })
  })

  it('owns desktop-profile help text', () => {
    const ctx = new Context()
    const exits: number[] = []
    let output = ''
    const sink = { write: (chunk: string) => { output += chunk; return true } }
    internals.stdout = sink
    internals.stderr = sink
    provideCmdline(ctx, { args: ['--help'], exit: code => void exits.push(code) })

    apply(ctx)

    expect(output).toContain('dsh --profile desktop')
    expect(output).not.toContain('dsh --profile web')
    expect(exits).toEqual([0])
  })
})
