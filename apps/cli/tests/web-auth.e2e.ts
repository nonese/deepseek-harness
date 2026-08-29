/** Real `dsh web` authentication against a temporary Harness home. */

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const DSH_SOURCE_BIN = join(REPO_ROOT, 'apps/cli/src/bin.ts')
const DSH_BUILT_BIN = join(REPO_ROOT, 'apps/cli/lib/bin.js')
const TSX_LOADER = pathToFileURL(createRequire(join(REPO_ROOT, 'package.json')).resolve('tsx')).href
const TEST_BOOTSTRAP_PASSWORD = 'real cli bootstrap password'
const TEST_MEMBER_PASSWORD = 'real cli ordinary password'

interface RunningWeb {
  readonly child: ChildProcess
  readonly launchUrl: string
  readonly output: () => string
}

interface HttpResult {
  readonly status: number
  readonly body: string
}

function redact(output: string): string {
  return output.replace(/([?&]token=)[^\s)]+/gu, '$1<redacted>')
}

/** Reserve one concrete loopback port, then release it for the CLI process. */
async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })
  return port
}

function cleanEnvironment(root: string, dshHome: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(name)))
  return {
    ...env,
    DSH_AGENTS_HOME: join(root, '.agents'),
    DSH_HOME: dshHome,
    DSH_TELEMETRY_DISABLED: '1',
    HARNESS_BOOTSTRAP_PASSWORD: TEST_BOOTSTRAP_PASSWORD,
    NODE_NO_WARNINGS: '1',
    SSH_CONNECTION: '',
    SSH_TTY: '',
    TSX_TSCONFIG_PATH: join(REPO_ROOT, 'tsconfig.json'),
  }
}

/** Start the public source or built CLI selected by the owning test lane and wait for its readiness URL. */
async function startWeb(root: string, dshHome: string, port: number): Promise<RunningWeb> {
  const entry = process.env.DSH_EXAMPLE_MODE === 'lib'
    ? [DSH_BUILT_BIN]
    : ['--import', TSX_LOADER, DSH_SOURCE_BIN]
  const child = spawn(process.execPath, [
    ...entry,
    'web',
    '--no-open',
    '--port', String(port),
  ], {
    cwd: root,
    env: cleanEnvironment(root, dshHome),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const launchUrl = await new Promise<string>((resolve, reject) => {
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }
    const timer = setTimeout(() => {
      fail(new Error(`dsh web did not become ready:\n${redact(output)}`))
    }, 90_000)
    const append = (chunk: Buffer | string): void => {
      output = `${output}${String(chunk)}`.slice(-100_000)
      const match = /dsh web: (http:\/\/[^\s]+)/u.exec(output)
      if (settled || match?.[1] === undefined) return
      settled = true
      clearTimeout(timer)
      resolve(match[1])
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    child.once('error', (error) => {
      fail(error)
    })
    child.once('exit', (code) => {
      fail(new Error(`dsh web exited before readiness (${String(code)}):\n${redact(output)}`))
    })
  })
  return { child, launchUrl, output: () => output }
}

async function stopWeb(running: RunningWeb): Promise<void> {
  if (running.child.exitCode !== null) return
  const exited = new Promise<void>((resolve) => { running.child.once('exit', () => { resolve() }) })
  running.child.kill('SIGTERM')
  const forced = setTimeout(() => { running.child.kill('SIGKILL') }, 10_000)
  forced.unref()
  await exited
  clearTimeout(forced)
}

/** POST one real Remote envelope while controlling the wire Host header. */
function describeSettings(port: number, host: string, cookie?: string): Promise<HttpResult> {
  const body = JSON.stringify({
    type: 'client-request',
    rpcId: 'web-auth-real-cli',
    method: 'settings/describe',
    payload: { args: {} },
  })
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/settings/describe',
      method: 'POST',
      headers: {
        host,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...cookie === undefined ? {} : { cookie },
      },
    }, (res) => {
      const chunks: Uint8Array[] = []
      res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    req.once('error', reject)
    req.end(body)
  })
}

describe('dsh web authentication through the real CLI', () => {
  it('rejects a forged loopback Host and preserves a local-login cookie across restart', { timeout: 180_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-web-auth-real-cli-'))
    const dshHome = join(root, '.dsh')
    const port = await freePort()
    let first: RunningWeb | undefined
    let second: RunningWeb | undefined
    try {
      first = await startWeb(root, dshHome, port)
      const firstUrl = new URL(first.launchUrl)
      expect(firstUrl.origin).toBe(`http://127.0.0.1:${String(port)}`)
      expect(firstUrl.pathname).toBe('/')
      expect(firstUrl.search).toBe('')

      const forgedHost = `127.0.0.1.example:${String(port)}`
      expect(await describeSettings(port, forgedHost)).toEqual({
        status: 403,
        body: 'forbidden',
      })

      const login = await fetch(new URL('/auth/login/local', firstUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: firstUrl.origin },
        body: JSON.stringify({ username: 'admin', password: TEST_BOOTSTRAP_PASSWORD }),
      })
      expect(login.status).toBe(200)
      const setCookie = login.headers.get('set-cookie')
      if (setCookie === null) throw new Error('real CLI local login omitted Set-Cookie')
      expect(setCookie).toContain('HttpOnly')
      expect(setCookie).toContain('SameSite=Lax')
      expect(setCookie).not.toContain('Secure')
      const cookie = setCookie.split(';', 1)[0]!

      expect((await describeSettings(port, forgedHost, cookie)).status).toBe(403)

      const authenticated = await describeSettings(port, firstUrl.host, cookie)
      expect(authenticated.status).toBe(200)
      const authenticatedBody = JSON.parse(authenticated.body) as unknown
      expect(authenticatedBody).toMatchObject({
        type: 'server-response',
        rpcId: 'web-auth-real-cli',
        result: { ok: true, value: { namespaces: expect.any(Array) as unknown } },
      })

      const createdMember = await fetch(new URL('/auth/users', firstUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: firstUrl.origin },
        body: JSON.stringify({ username: 'member', password: TEST_MEMBER_PASSWORD, role: 'user' }),
      })
      expect(createdMember.status).toBe(201)
      const memberLogin = await fetch(new URL('/auth/login/local', firstUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: firstUrl.origin },
        body: JSON.stringify({ username: 'member', password: TEST_MEMBER_PASSWORD }),
      })
      expect(memberLogin.status).toBe(200)
      const memberSetCookie = memberLogin.headers.get('set-cookie')
      if (memberSetCookie === null) throw new Error('real CLI member login omitted Set-Cookie')
      const memberCookie = memberSetCookie.split(';', 1)[0]!
      const ordinarySettings = await describeSettings(port, firstUrl.host, memberCookie)
      expect(ordinarySettings.status).toBe(200)
      expect(JSON.parse(ordinarySettings.body) as unknown).toMatchObject({
        type: 'server-response',
        rpcId: 'web-auth-real-cli',
        result: { ok: false, error: { code: 'forbidden', message: 'administrator role is required' } },
      })

      await stopWeb(first)
      first = undefined
      second = await startWeb(root, dshHome, port)
      const secondUrl = new URL(second.launchUrl)
      expect(secondUrl.search).toBe('')
      expect((await describeSettings(port, secondUrl.host, cookie)).status).toBe(200)
      expect(JSON.parse((await describeSettings(port, secondUrl.host, memberCookie)).body) as unknown).toMatchObject({
        result: { ok: false, error: { code: 'forbidden' } },
      })

      const credentialMode = (await stat(join(dshHome, '.credentials.yaml'))).mode & 0o777
      expect(credentialMode).toBe(0o600)
    } catch (error) {
      const evidence = [first?.output(), second?.output()].filter(value => value !== undefined).join('\n')
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${redact(evidence)}`, { cause: error })
    } finally {
      if (second !== undefined) await stopWeb(second)
      if (first !== undefined) await stopWeb(first)
      await rm(root, { recursive: true, force: true })
    }
  })
})
