/** Electron owner for activation, lease renewal, and the local DSH process. */

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  generateDesktopDeviceKeys,
  signDesktopDeviceProof,
  verifyDesktopLease,
} from '@deepseek-ai/dsh-desktop-auth'
import {
  acceptDesktopPackage,
  installOrganizationConfiguration,
  parseDesktopBuildConfig,
  parseDshWebUrl,
  verifyActivationForKeys,
  type DesktopActivationPackage,
  type DesktopBuildConfig,
  type DesktopState,
} from './runtime.ts'
import { createDesktopStartupLogger, type DesktopStartupLogger } from './diagnostics.ts'
import { windowsProcessTreeArguments } from './process-tree.ts'

const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000
const POLL_INTERVAL_MS = 2_000
const STATE_FILENAME = 'desktop-auth.bin'

let window: BrowserWindow | undefined
let child: ChildProcessWithoutNullStreams | undefined
let state: DesktopState | undefined
let buildConfig: DesktopBuildConfig
let activationRunning = false
let diagnostics: DesktopStartupLogger | undefined
let quitApproved = false
let quitRequested = false
const safeMode = process.argv.includes('--safe-mode')

function record(event: string, details?: Readonly<Record<string, string | number | boolean | null>>): void {
  diagnostics?.record(event, details)
}

function sendStatus(
  kind: 'busy' | 'error' | 'ready',
  message: string,
  action: 'activate' | 'launch' | 'none' = 'none',
): void {
  window?.webContents.send('desktop-status', { kind, message, action })
}

async function fetchJson(url: string, body: unknown): Promise<{ status: number; value: unknown }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const value: unknown = await response.json()
  if (!response.ok && response.status !== 202) {
    const error = typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)['error']
      : undefined
    const message = typeof error === 'object' && error !== null && !Array.isArray(error)
      ? (error as Record<string, unknown>)['message']
      : undefined
    throw new Error(typeof message === 'string' ? message : `server returned HTTP ${String(response.status)}`)
  }
  return { status: response.status, value }
}

function statePath(): string {
  return join(app.getPath('userData'), STATE_FILENAME)
}

async function loadState(): Promise<DesktopState | undefined> {
  let encrypted: string
  try {
    encrypted = await readFile(statePath(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  return JSON.parse(safeStorage.decryptString(Buffer.from(encrypted.trim(), 'base64'))) as DesktopState
}

async function saveState(next: DesktopState): Promise<void> {
  const encrypted = safeStorage.encryptString(JSON.stringify(next)).toString('base64')
  await writeFileAtomic(statePath(), `${encrypted}\n`, {
    mode: 0o600,
    dirMode: 0o700,
  })
}

function leaseDigest(lease: string): string {
  return createHash('sha256').update(lease).digest('base64url')
}

async function configurationProof(current: DesktopState, purpose: 'lease-renew' | 'config-sync'): Promise<string> {
  return signDesktopDeviceProof(current.keys.signature.privateJwk, current.deviceId, {
    purpose,
    deviceId: current.deviceId,
    leaseDigest: leaseDigest(current.lease),
  })
}

async function persistAccepted(next: DesktopState): Promise<void> {
  await installOrganizationConfiguration(
    join(app.getPath('userData'), 'dsh-home'),
    next.organizationConfiguration,
  )
  await saveState(next)
  state = next
}

async function refreshAuthorization(): Promise<void> {
  if (state === undefined) return
  record('authorization-refresh-start')
  const lease = await verifyDesktopLease(state.lease, buildConfig.serverSigningPublicJwk, buildConfig.serverOrigin)
  const expiresAt = (lease.exp ?? 0) * 1000
  const endpoint = expiresAt - Date.now() <= RENEW_BEFORE_MS ? 'lease/renew' : 'config/sync'
  const purpose = endpoint === 'lease/renew' ? 'lease-renew' : 'config-sync'
  try {
    const result = await fetchJson(
      `${buildConfig.serverOrigin}/auth/desktop/${endpoint}`,
      { lease: state.lease, proof: await configurationProof(state, purpose) },
    )
    if (endpoint === 'lease/renew') {
      await persistAccepted(await acceptDesktopPackage(result.value as DesktopActivationPackage, state.keys, buildConfig))
    } else {
      const accepted = await acceptDesktopPackage({
        ...(result.value as DesktopActivationPackage),
        lease: state.lease,
        leaseExpiresAt: state.leaseExpiresAt,
      }, state.keys, buildConfig)
      await persistAccepted(accepted)
    }
    record('authorization-refresh-complete', { endpoint })
  } catch (error) {
    if (expiresAt <= Date.now()) throw error
    record('authorization-refresh-offline', { error: error instanceof Error ? error.message : String(error) })
    sendStatus('busy', '服务器暂时不可达，正在使用仍有效的离线授权。')
  }
}

async function activate(): Promise<void> {
  if (activationRunning) return
  activationRunning = true
  try {
    record('activation-start')
    sendStatus('busy', '正在向服务器申请设备登录…')
    const keys = generateDesktopDeviceKeys()
    const started = await fetchJson(
      `${buildConfig.serverOrigin}/auth/desktop/activation/start`,
      {
        label: `${hostname()} · Windows`,
        appVersion: app.getVersion(),
        signaturePublicJwk: keys.signature.publicJwk,
        encryptionPublicJwk: keys.encryption.publicJwk,
      },
    )
    const activationToken = typeof started.value === 'object' && started.value !== null && !Array.isArray(started.value)
      ? (started.value as Record<string, unknown>)['activation']
      : undefined
    if (typeof activationToken !== 'string') {
      throw new Error('server returned an invalid desktop activation response')
    }
    const activation = await verifyActivationForKeys(activationToken, keys, buildConfig)
    await shell.openExternal(activation.authorizationUrl)
    sendStatus('busy', '请在浏览器中完成统一身份认证，客户端会自动继续。')
    const proof = await signDesktopDeviceProof(keys.signature.privateJwk, `pending:${activation.flowId}`, {
      purpose: 'activation-complete',
      flowId: activation.flowId,
      challenge: activation.challenge,
    })
    while (Date.now() < (activation.exp ?? 0) * 1000) {
      const completed = await fetchJson(
        `${buildConfig.serverOrigin}/auth/desktop/activation/complete`,
        { flowId: activation.flowId, proof },
      )
      if (completed.status === 200) {
        await persistAccepted(await acceptDesktopPackage(completed.value as DesktopActivationPackage, keys, buildConfig))
        record('activation-complete')
        sendStatus('ready', '设备登录完成。准备好后再启动本地 DSH。', 'launch')
        return
      }
      await new Promise(resolveDelay => setTimeout(resolveDelay, POLL_INTERVAL_MS))
    }
    throw new Error('登录请求已过期，请重新登录')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    record('activation-error', { error: message })
    sendStatus('error', message, 'activate')
  } finally {
    activationRunning = false
  }
}

function launchDsh(): void {
  if (child !== undefined) return
  sendStatus('busy', '正在启动本地 DSH…')
  const resources = process.resourcesPath
  const runtime = join(resources, 'runtime')
  const dshHome = join(app.getPath('userData'), 'dsh-home')
  child = spawn(join(runtime, 'node.exe'), [
    join(runtime, 'lib', 'bin.js'),
    '--profile', 'desktop', '--host', '127.0.0.1', '--port', '0', '--no-open',
  ], {
    cwd: app.getPath('documents'),
    env: {
      ...process.env,
      DSH_HOME: dshHome,
      DSH_DISABLE_DREAMINA: '1',
      DSH_PERMISSION_MODE: 'danger-full-access',
    },
    windowsHide: true,
  })
  record('dsh-spawned', { pid: child.pid ?? -1 })
  let buffered = ''
  child.stdout.on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8')
    const lines = buffered.split(/\r?\n/u)
    buffered = lines.pop() ?? ''
    for (const line of lines) {
      const url = parseDshWebUrl(line)
      if (url !== undefined) {
        record('dsh-ready')
        sendStatus('ready', '本地 DSH 已启动。')
        void window?.loadURL(url)
      }
    }
  })
  child.stderr.on('data', (chunk: Buffer) => {
    const message = chunk.toString('utf8').trimEnd()
    record('dsh-stderr', { message })
    console.error(message)
  })
  child.once('error', (error) => {
    record('dsh-error', { error: error.message })
    sendStatus('error', `无法启动本地 DSH：${error.message}`, 'launch')
  })
  child.once('exit', (code) => {
    child = undefined
    record('dsh-exit', { code: code ?? -1 })
    if (!(app as typeof app & { isQuitting: boolean }).isQuitting) {
      sendStatus('error', `本地 DSH 已退出（${String(code)}）`, 'launch')
    }
  })
}

async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#eff6ff',
    title: '奉中附小 DSH',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(app.getAppPath(), 'assets', 'preload.cjs'),
    },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http://127.0.0.1:') || url.startsWith('file:')) return
    event.preventDefault()
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
  })
  window.webContents.on('unresponsive', () => { record('renderer-unresponsive') })
  window.webContents.on('render-process-gone', (_event, details) => {
    record('renderer-exit', { reason: details.reason, exitCode: details.exitCode })
  })
  await window.loadFile(join(app.getAppPath(), 'assets', 'activation.html'))
  record('activation-window-ready')
}

function stopWindowsProcessTree(pid: number, force: boolean): void {
  const result = spawnSync('taskkill', windowsProcessTreeArguments(pid, force), {
    stdio: 'ignore',
    timeout: 2_000,
    windowsHide: true,
  })
  if (result.error !== undefined) {
    record('dsh-stop-tree-error', { error: result.error.message, force })
  } else if (result.status !== 0) {
    record('dsh-stop-tree-nonzero', { code: result.status ?? -1, force })
  }
}

async function stopDsh(): Promise<void> {
  const running = child
  if (running === undefined || running.exitCode !== null) return
  const pid = running.pid
  if (pid === undefined || pid <= 0) {
    record('dsh-stop-invalid-pid')
    running.kill()
    return
  }
  record('dsh-stop-requested', { pid })
  const exited = new Promise<void>((resolveExit) => { running.once('exit', () => { resolveExit() }) })
  const waitForExit = (timeout: number): Promise<boolean> => Promise.race([
    exited.then(() => true),
    new Promise<false>((resolveTimeout) => { setTimeout(() => { resolveTimeout(false) }, timeout) }),
  ])
  stopWindowsProcessTree(pid, false)
  if (await waitForExit(5_000)) return
  record('dsh-stop-timeout', { pid })
  stopWindowsProcessTree(pid, true)
  if (await waitForExit(2_000)) return
  record('dsh-stop-force-timeout', { pid })
  running.stdin.destroy()
  running.stdout.destroy()
  running.stderr.destroy()
  running.unref()
}

/** Start the Electron-owned activation and local-runtime lifecycle. */
export function startDesktopApplication(): void {
  app.disableHardwareAcceleration()
  diagnostics = createDesktopStartupLogger(join(app.getPath('userData'), 'logs'))
  record('application-start', { safeMode, hardwareAcceleration: false, version: app.getVersion() })

  Object.defineProperty(app, 'isQuitting', { value: false, writable: true })

  if (!app.requestSingleInstanceLock()) app.quit()
  else {
    app.on('second-instance', () => {
      window?.show()
      window?.focus()
    })
    app.on('before-quit', (event) => {
      if (quitApproved) return
      event.preventDefault()
      if (quitRequested) return
      quitRequested = true
      ;(app as typeof app & { isQuitting: boolean }).isQuitting = true
      void stopDsh().finally(() => {
        record('application-quit')
        quitApproved = true
        app.quit()
      })
    })
    app.on('window-all-closed', () => { app.quit() })
    app.whenReady().then(async () => {
      if (process.platform !== 'win32') throw new Error('奉中附小 DSH desktop build supports Windows only')
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Windows DPAPI is unavailable for desktop credential storage')
      }
      buildConfig = parseDesktopBuildConfig(await readFile(join(process.resourcesPath, 'desktop.config.json'), 'utf8'))
      if (!safeMode) {
        ipcMain.handle('desktop-activate', activate)
        ipcMain.handle('desktop-launch', () => { launchDsh() })
      }
      await createWindow()
      state = await loadState()
      if (safeMode) {
        record('safe-mode-ready')
        sendStatus('ready', '安全模式已启动。服务器连接和本地 DSH 均未运行。')
      } else if (state === undefined) sendStatus('ready', '首次使用需要通过单位账号激活这台设备。', 'activate')
      else {
        await refreshAuthorization()
        sendStatus('ready', '设备授权有效。准备好后再启动本地 DSH。', 'launch')
      }
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      record('application-error', { error: message })
      sendStatus('error', message)
      const diagnostic = diagnostics === undefined ? '' : `\n\n启动日志：${diagnostics.path}`
      dialog.showErrorBox('奉中附小 DSH 启动失败', `${message}${diagnostic}`)
      console.error(error)
      app.quit()
    })
  }
}
