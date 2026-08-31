/**
 * The sandbox POLICY home (`ctx.sandboxPolicy`): the single owner of the
 * deployment's sandbox fallbacks plus per-session resolution: the file-effect
 * {@link SandboxMode}, the `workspace-write` root, and the override kit (the
 * `sandbox/mode` event, its fold, and its write path; the fold is the
 * `sandboxMode` session-projection unit registered here, while the event and
 * write path come from `./session-mode.ts`).
 * Before each agent request, the owner also contributes the resolved policy to
 * the cache-safe runtime-context snapshot. The agent loop logs that snapshot as
 * model history, so replay reconstructs the same mode and root the enforcing
 * consumers resolve without rewriting the stable system prompt.
 *
 * Enforcing filesystem, one-shot bash, and terminal backends read the SAME
 * resolved policy here. The context describes that policy without inventorying
 * capabilities, while each backend retains its own enforcement dialect and each
 * tool owns its operation-specific denial and escalation guidance. The service
 * reads session state once at each operation boundary; executors and providers
 * remain session-free.
 *
 * @module @deepseek-ai/dsh-sandbox-policy
 */

import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve as resolvePath, sep } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { ESCALATION_TARGETS, type SandboxExecutionPolicy, type SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-system-prompt'

export { SANDBOX_MODES, setSandboxMode } from './session-mode.ts'

/**
 * Resolve filesystem identity before lexical normalization can erase
 * symlink-sensitive components. Missing suffixes inherit the canonical
 * spelling of their deepest existing ancestor, so a fresh private root and
 * its not-yet-created user child cannot disagree on `/tmp` vs `/private/tmp`.
 */
function resolveWorkspaceRoot(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    // A missing suffix still needs the canonical identity of its ancestor.
  }
  let current = resolvePath(path)
  const missing: string[] = []
  while (true) {
    try {
      return resolvePath(realpathSync.native(current), ...missing.reverse())
    } catch {
      const parent = dirname(current)
      if (parent === current) return resolvePath(path)
      missing.push(basename(current))
      current = parent
    }
  }
}

const MODE_RANK: Record<SandboxMode, number> = {
  'read-only': 0,
  'workspace-write': 1,
  'danger-full-access': 2,
}

/** Test canonical containment without accepting a sibling prefix. */
function containsPath(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

/** Derive the direct authenticated-user root that owns one workspace. */
function readableRootFor(workspaceRoot: string, accessRootParent: string): string | undefined {
  const path = relative(accessRootParent, workspaceRoot)
  if (path === '' || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) return undefined
  const [owner] = path.split(sep)
  return owner === undefined || owner.length === 0 ? undefined : resolveWorkspaceRoot(resolvePath(accessRootParent, owner))
}

/** Render the policy without claiming which capabilities are mounted. */
function renderPolicyContext(policy: SandboxExecutionPolicy): string {
  let modeContext: string
  switch (policy.mode) {
    case 'read-only':
      modeContext = 'Current DSH file policy: read-only. Any available operation enforced by the DSH file sandbox cannot modify files in the standing mode. Do not refuse a required modification from this policy alone: try an available tool normally and follow any denial and escalation guidance it returns.'
      break
    case 'workspace-write':
      modeContext = `Current DSH file policy: workspace-write. Any available operation enforced by the DSH file sandbox may modify files under the session workspace: ${JSON.stringify(policy.workspaceRoot)}. Some platform temporary areas may also be writable.`
      break
    case 'danger-full-access':
      modeContext = 'Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.'
      break
    /* v8 ignore next 4 -- SandboxMode is a typed same-process closed union; this branch is only the static exhaustiveness guard. */
    default: {
      const mode: never = policy.mode
      throw new Error(`unreachable sandbox mode: ${String(mode)}`)
    }
  }
  return policy.readableRoot === undefined
    ? modeContext
    : `${modeContext} Reads and searches are limited to the authenticated user root: ${JSON.stringify(policy.readableRoot)}.`
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sandboxPolicy: SandboxPolicyService
  }
}

/**
 * Plugin config: the deployment's sandbox default. All optional — `Config`
 * supplies the defaults (`mode: 'read-only'` is the fail-safe default; a
 * deployment that wants a workspace-writable agent opts in explicitly). The
 * runner choice is NOT here (it is the `ctx.sandbox` provider's config), nor
 * is any per-family knob: this is the one shared policy home.
 */
export interface Config {
  /** File-sandbox mode a session starts from (default: `read-only`). */
  mode?: SandboxMode
  /**
   * Fallback root for agentless calls and sessions without a cwd (default:
   * `process.cwd()`). Normal agent calls use their session cwd instead.
   */
  workspaceRoot?: string
  /** Deployment ceiling; calls and persisted session overrides cannot exceed it. */
  maximumMode?: SandboxMode
  /** Host-private tree hidden from confined subprocesses (for example `$DSH_HOME`). */
  privateRoot?: string
  /** Parent whose direct children are authenticated user roots. Requires `privateRoot`. */
  accessRootParent?: string
}

/** Inputs that select the sandbox policy for one capability call. */
export interface SandboxPolicyRequest {
  /** Calling session; its immutable cwd becomes the workspace boundary. */
  session?: Session
  /** Explicit approved mode override, which outranks session policy. */
  mode?: SandboxMode
}

/** The sandbox-mode projection's state schema (state equals the public shape). */
const sandboxModeStateSchema = zod.union([
  zod.literal('read-only'),
  zod.literal('workspace-write'),
  zod.literal('danger-full-access'),
]).nullable()

type SandboxModeState = zod.infer<typeof sandboxModeStateSchema>
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Last logged sandbox-mode override, or null before one (deployment default applies at resolve time). */
    sandboxMode: SandboxModeState
  }
}

/**
 * The sandbox-policy service (`ctx.sandboxPolicy`). Owns the deployment
 * default mode, fallback workspace root, and current request-time policy
 * section. Tool layers call {@link resolve} for each execution so a session's
 * mode log and immutable cwd travel together to every enforcing capability.
 */
export class SandboxPolicyService extends Service {
  // Inline schema call: the config catalog walks `static Config` statically.
  static Config: z<Config> = z.object({
    mode: z.union(['read-only', 'workspace-write', 'danger-full-access'] as const).default('read-only'),
    maximumMode: z.union(['read-only', 'workspace-write', 'danger-full-access'] as const).default('danger-full-access'),
    // No schema default: process.cwd() is resolved in the constructor so the
    // stored root is always absolute regardless of how it was supplied.
    workspaceRoot: z.string(),
    privateRoot: z.string(),
    accessRootParent: z.string(),
  })

  static inject = ['sessionProjections']

  /** The deployment default mode — the fallback beneath a session override. */
  readonly defaultMode: SandboxMode
  /** Widest mode this deployment permits, including approved retries. */
  readonly maximumMode: SandboxMode
  /** Schema-safe escalation targets that do not exceed {@link maximumMode}. */
  readonly escalationModes: readonly SandboxMode[]
  /** The absolute `workspace-write` fallback root for calls without a session cwd. */
  readonly workspaceRoot: string
  /** Canonical host-private tree, when read isolation is enabled. */
  readonly privateRoot: string | undefined
  /** Canonical parent of per-user roots, when read isolation is enabled. */
  readonly accessRootParent: string | undefined
  constructor(ctx: Context, config: Config) {
    super(ctx, 'sandboxPolicy')
    // schemastery (static Config) already filled `mode`; the cast records that
    // runtime fact. `workspaceRoot` has NO schema default, so its fallback to
    // the process cwd is real branching, resolved absolute either way.
    this.defaultMode = config.mode as SandboxMode
    this.maximumMode = config.maximumMode as SandboxMode
    if (MODE_RANK[this.defaultMode] > MODE_RANK[this.maximumMode]) {
      throw new Error(`sandbox-policy: default mode "${this.defaultMode}" exceeds maximumMode "${this.maximumMode}"`)
    }
    this.escalationModes = ESCALATION_TARGETS.filter(mode => this.allowsMode(mode))
    this.workspaceRoot = resolveWorkspaceRoot(config.workspaceRoot ?? process.cwd())
    if ((config.privateRoot === undefined) !== (config.accessRootParent === undefined)) {
      throw new Error('sandbox-policy: privateRoot and accessRootParent must be configured together')
    }
    this.privateRoot = config.privateRoot === undefined ? undefined : resolveWorkspaceRoot(config.privateRoot)
    this.accessRootParent = config.accessRootParent === undefined ? undefined : resolveWorkspaceRoot(config.accessRootParent)
    if (this.privateRoot !== undefined && resolvePath(this.privateRoot, '..') === this.privateRoot) {
      throw new Error('sandbox-policy: privateRoot must not be a filesystem root')
    }
    if (this.privateRoot !== undefined && this.accessRootParent !== undefined && !containsPath(this.privateRoot, this.accessRootParent)) {
      throw new Error(`sandbox-policy: accessRootParent ${JSON.stringify(this.accessRootParent)} must be inside privateRoot ${JSON.stringify(this.privateRoot)}`)
    }

    ctx.sessionProjections.register({
      key: 'sandboxMode',
      stateVersion: 1,
      stateSchema: sandboxModeStateSchema,
      init: () => null,
      apply: (state, event) => (event.type === 'sandbox/mode' ? event.data.mode : state),
    })

    ctx.inject(['systemPrompt'], (scope: Context) => {
      scope.systemPrompt.context({
        name: 'sandbox:policy',
        order: scope.systemPrompt.getContextOrder('SANDBOX_POLICY'),
        text: (context) => {
          const session = context.agent?.session
          return session === undefined
            ? ''
            : renderPolicyContext(this.resolve({ session }))
        },
      })
    })
  }

  /**
   * Resolve the complete policy for one capability call. An approved explicit
   * mode outranks the session's last `sandbox/mode` event, which outranks the
   * deployment default. A session cwd is its workspace-write boundary; the
   * configured root is the fallback for agentless calls and sessions without a
   * cwd.
   * @param request - optional session and approved mode override.
   * @returns the fully resolved per-call mode and absolute workspace root.
   */
  resolve(request: SandboxPolicyRequest = {}): SandboxExecutionPolicy {
    const { session } = request
    if (request.mode !== undefined && !this.allowsMode(request.mode)) {
      throw new Error(`sandbox mode "${request.mode}" exceeds this deployment's maximum "${this.maximumMode}"`)
    }
    const requestedMode = request.mode ?? (session === undefined ? undefined : this.overrideOf(session)) ?? this.defaultMode
    const mode = this.allowsMode(requestedMode) ? requestedMode : this.maximumMode
    const workspaceRoot = resolveWorkspaceRoot(session?.header.cwd ?? this.workspaceRoot)
    const readableRoot = this.accessRootParent === undefined ? undefined : readableRootFor(workspaceRoot, this.accessRootParent)
    if (session !== undefined && this.privateRoot !== undefined && readableRoot === undefined) {
      throw new Error('sandbox-policy: authenticated session workspace is outside a configured user root')
    }
    return {
      mode,
      workspaceRoot,
      ...this.privateRoot === undefined ? {} : { privateRoot: this.privateRoot },
      ...readableRoot === undefined ? {} : { readableRoot },
      ...session === undefined ? {} : { sessionId: session.id },
    }
  }

  /**
   * Return whether `mode` is at or below the deployment ceiling.
   * @param mode - candidate mode to compare with the configured maximum.
   * @returns whether the deployment permits the mode.
   */
  allowsMode(mode: SandboxMode): boolean {
    return MODE_RANK[mode] <= MODE_RANK[this.maximumMode]
  }

  /**
   * Read the session override without applying the deployment default.
   * @param session - session whose log supplies the override.
   * @returns the last logged mode, or `undefined` without one.
   */
  overrideOf(session: Session): SandboxMode | undefined {
    return this.ctx.sessionProjections.stateOf(session, 'sandboxMode') ?? undefined
  }
}

export default SandboxPolicyService
