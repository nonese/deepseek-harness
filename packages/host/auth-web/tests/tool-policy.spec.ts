import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { AuthUser, UserId } from '@deepseek-ai/dsh-auth'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolDefinition, type ToolExecution } from '@deepseek-ai/dsh-tools'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { apply, inject } from '../src/index.ts'

const signal = new AbortController().signal

function user(username: string, role: 'admin' | 'user'): AuthUser {
  return {
    id: `${username}-id` as UserId,
    username,
    displayName: username,
    role,
    status: 'active',
    authMethods: ['local'],
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function tool(name: string, execute: ToolDefinition['execute']): ToolDefinition {
  return {
    name,
    description: `tool ${name}`,
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value as string }],
    },
    execute,
  }
}

function agent(ctx: Context, username: string, cwd: string): NonNullable<ToolExecution['agent']> {
  return {
    id: SessionId(username),
    session: { header: { cwd } },
    ctx,
  } as unknown as NonNullable<ToolExecution['agent']>
}

function resultText(result: Awaited<ReturnType<ToolRuntime['execute']>>): string {
  const first = result.content[0]
  return first?.type === 'text' ? first.text : JSON.stringify(result.content)
}

describe('dynamic Cordis tool policy', () => {
  it('allows only administrators and rechecks their status before execution', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const roles = new Map<string, AuthUser>([
      ['/srv/users/alice/projects/demo', user('alice', 'user')],
      ['/srv/users/root/projects/demo', user('root', 'admin')],
    ])
    ctx.provide('auth', {
      ownerForProjectPath: (path: string) => roles.get(path),
    } as never)
    ctx.provide('credentials', {} as never)
    ctx.provide('sessions', {} as never)
    ctx.provide('workspaceRegistry', {} as never)
    ctx.provide('webServer', {
      register: () => () => {},
    } as unknown as WebServer)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const executeCordis = vi.fn(async () => 'cordis ran')
    ctx.tools.register(tool('cordis_define', executeCordis))
    const ordinary = agent(ctx, 'alice', '/srv/users/alice/projects/demo')
    const administrator = agent(ctx, 'root', '/srv/users/root/projects/demo')
    expect(resultText(await ctx.tools.execute({
      signal,
      callId: CallId('ordinary-call'),
      name: 'cordis_define',
      arguments: {},
      agent: ordinary,
    }))).toBe('Error: 仅管理员可使用动态 Cordis 插件')
    expect(resultText(await ctx.tools.execute({
      signal,
      callId: CallId('admin-call'),
      name: 'cordis_define',
      arguments: {},
      agent: administrator,
    }))).toBe('cordis ran')

    roles.set('/srv/users/root/projects/demo', user('root', 'user'))
    expect(resultText(await ctx.tools.execute({
      signal,
      callId: CallId('demoted-call'),
      name: 'cordis_define',
      arguments: {},
      agent: administrator,
    }))).toBe('Error: 仅管理员可使用动态 Cordis 插件')
    expect(executeCordis).toHaveBeenCalledTimes(1)

    await fiber.dispose()
  })
})
