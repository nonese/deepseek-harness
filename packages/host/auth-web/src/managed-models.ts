/** Administrator-managed model-site projection shared by HTTP routes and remote policy. */

import type { Context } from '@deepseek-ai/cordis'
import {
  isManagedModelCredentialRef,
  MANAGED_MODEL_CREDENTIAL_PREFIX,
  type UserId,
} from '@deepseek-ai/dsh-auth'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  PROVIDER as DEEPSEEK_PROVIDER,
  PUBLIC_BASE_URL as DEEPSEEK_BASE_URL,
  SHARED_DEEPSEEK_API_KEY_ENV,
  SHARED_DEEPSEEK_MODEL,
} from '@deepseek-ai/dsh-llm-deepseek'
import type { Config as PiAiConfig, PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type {} from '@deepseek-ai/dsh-settings'

/** Settings namespace that owns custom OpenAI-compatible provider profiles. */
export const MANAGED_MODEL_SETTINGS_NS = 'llm-pi-ai'
/** Route prefix reserved for administrator-managed custom sites. */
export const MANAGED_MODEL_PROVIDER_PREFIX = 'managed-'
/** Maximum number of custom managed sites one deployment may expose. */
export const MAX_MANAGED_MODEL_SITES = 32
/** Maximum model ids declared by one managed site. */
export const MAX_MANAGED_SITE_MODELS = 32

/** Public non-secret model row for one managed site. */
export interface ManagedModelRow {
  id: string
  name: string
}

/** Public non-secret state for one administrator-managed model site. */
export interface ManagedModelSiteStatus {
  id: string
  kind: 'deepseek-official' | 'openai-compatible'
  provider: string
  name: string
  baseURL: string
  models: readonly ManagedModelRow[]
  configured: boolean
  writable: boolean
}

/** User or administrator view of all managed model sites. */
export interface ManagedModelsStatus {
  configured: boolean
  sites: readonly ManagedModelSiteStatus[]
  enabled?: boolean
}

/** One custom profile whose route and credential reference use the reserved managed-site identity. */
export interface ManagedCustomProfile {
  id: string
  provider: string
  credential: string
  profile: PiAiProviderProfile
}

/**
 * Derive the credential reference reserved for a custom managed-site id.
 * @param id - twelve-character lowercase hexadecimal site id.
 * @returns credential reference persisted by the credentials provider.
 */
export function managedModelCredentialName(id: string): string {
  if (!/^[a-f0-9]{12}$/u.test(id)) throw new TypeError('managed model site id must be twelve lowercase hexadecimal characters')
  return `${MANAGED_MODEL_CREDENTIAL_PREFIX}${id.toUpperCase()}_API_KEY`
}

/**
 * Read custom managed profiles from the validated pi-ai settings section.
 * @param ctx - Host context carrying the registered settings namespace.
 * @returns profiles created through the managed-model administration API.
 */
export function managedCustomProfiles(ctx: Context): ManagedCustomProfile[] {
  const config = ctx.settings.get(MANAGED_MODEL_SETTINGS_NS) as PiAiConfig | undefined
  const providers = config?.providers ?? {}
  const result: ManagedCustomProfile[] = []
  for (const [provider, profile] of Object.entries(providers)) {
    if (!provider.startsWith(MANAGED_MODEL_PROVIDER_PREFIX)) continue
    const id = provider.slice(MANAGED_MODEL_PROVIDER_PREFIX.length)
    if (!/^[a-f0-9]{12}$/u.test(id)) continue
    const credential = profile.apiKeyEnv
    if (credential !== managedModelCredentialName(id) || !isManagedModelCredentialRef(credential)) continue
    if (profile.api !== 'openai-completions' || profile.baseURL === undefined || profile.models === undefined) continue
    result.push({ id, provider, credential, profile })
  }
  return result.sort((left, right) => left.profile.displayName?.localeCompare(right.profile.displayName ?? '') ?? 0)
}

/**
 * Read every non-secret managed-site status for an administrator or one user.
 * @param ctx - Host context carrying credentials, settings, and authentication.
 * @param userId - optional user whose opt-in state is included.
 * @returns official DeepSeek plus every custom managed site.
 */
export async function managedModelsStatus(ctx: Context, userId?: UserId): Promise<ManagedModelsStatus> {
  const officialCredential = await ctx.credentials.describe(credentialRef(SHARED_DEEPSEEK_API_KEY_ENV))
  const official: ManagedModelSiteStatus = {
    id: DEEPSEEK_PROVIDER,
    kind: 'deepseek-official',
    provider: DEEPSEEK_PROVIDER,
    name: 'DeepSeek',
    baseURL: DEEPSEEK_BASE_URL,
    models: [{ id: SHARED_DEEPSEEK_MODEL, name: 'DeepSeek-V4-Flash' }],
    configured: officialCredential.configured,
    writable: officialCredential.writable,
  }
  const custom = await Promise.all(managedCustomProfiles(ctx).map(async (entry): Promise<ManagedModelSiteStatus> => {
    const credential = await ctx.credentials.describe(credentialRef(entry.credential))
    return {
      id: entry.id,
      kind: 'openai-compatible',
      provider: entry.provider,
      name: entry.profile.displayName ?? entry.provider,
      baseURL: entry.profile.baseURL as string,
      models: (entry.profile.models ?? []).map(model => ({ id: model.id, name: model.name ?? model.id })),
      configured: credential.configured,
      writable: credential.writable && ctx.settings.writable,
    }
  }))
  const sites = [official, ...custom]
  return {
    configured: sites.some(site => site.configured),
    sites,
    ...userId === undefined ? {} : { enabled: ctx.auth.sharedDeepSeekPreference(userId).enabled },
  }
}

/**
 * Resolve configured managed models by provider route for one opted-in user projection.
 * @param ctx - Host context carrying model-site settings and credentials.
 * @returns provider to configured model ids, omitting sites without a stored key.
 */
export async function configuredManagedProviderModels(ctx: Context): Promise<Map<string, readonly string[]>> {
  const result = new Map<string, readonly string[]>()
  const status = await managedModelsStatus(ctx)
  for (const site of status.sites) {
    if (site.configured) result.set(site.provider, site.models.map(model => model.id))
  }
  return result
}
