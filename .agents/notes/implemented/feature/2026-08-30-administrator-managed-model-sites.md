# Agent Note: Administrator-managed model sites

Status: implemented

English | [中文](2026-08-30-administrator-managed-model-sites.zh.md)

## Problem

The multi-user Web server offered one administrator credential for one fixed DeepSeek model. An intranet deployment can also have an OpenAI-compatible gateway such as New API, but ordinary users cannot safely share its key through personal settings or process environment variables. A model route shown to every user without request-time authorization would also let a user bypass the preference switch by constructing an RPC request directly.

## Decision

The system settings page keeps the fixed `deepseek-official/deepseek-v4-flash` site and lets an administrator add up to 32 custom OpenAI Chat Completions-compatible sites. After the administrator enters an HTTP or HTTPS Base URL and API key, the Host uses pi-ai model discovery to request that site's `/models` endpoint and offers the returned models for selection. Each custom site stores a display name, a Base URL without credentials, query, or fragment, and up to 32 selected model ids. The Host assigns a random twelve-hexadecimal site id and reserves the corresponding `managed-<site id>` pi-ai provider route.

Every site has its own server-side credential reference. The official site uses `HARNESS_SHARED_DEEPSEEK_API_KEY`; a custom site uses `HARNESS_SHARED_MODEL_<SITE ID>_API_KEY`. HTTP responses expose only whether a credential is configured and writable. Creating a custom site writes its credential before its profile and removes the credential if the settings provider refuses the profile. Removing a site removes both records.

One existing per-user preference authorizes all administrator-managed sites. The Gateway removes custom managed routes from an ordinary user's model catalog unless that user has opted in and the site credential is configured. The pi-ai credential resolver independently resolves the live Session's project owner and refuses a managed credential when that owner has not opted in. Discovery can describe a route without a Session but cannot use its credential for generation.

The reserved route and credential grammar distinguishes this policy from ordinary pi-ai deployment profiles. Existing non-managed `apiKeyEnv` references retain their process-wide behavior, and the existing DeepSeek adapter retains its dedicated managed-Flash authorization.

## Verification

Host route tests cover official-site credential replacement, custom-site discovery, creation, update, deletion, input validation, administrator-only mutation, and non-disclosure of submitted keys. Gateway tests cover opted-out catalog removal and fallback selection. Pi-ai composition tests prove that a direct model request cannot consume a managed key until the project owner opts in, and client tests cover automatic discovery, administrator model selection, and ordinary-user activation.

## Alternatives considered

**Replace the official DeepSeek site with one generic custom-site record.** Rejected because the official route has a dedicated adapter, known endpoint, fixed product model, and existing credential data. Keeping it preserves the direct DeepSeek behavior while custom sites use the generic pi-ai adapter.

**Store one shared key and Base URL in each user's settings.** Rejected because browser-visible or per-user copies multiply secret exposure and rotation work. The administrator owns one credential per site, while users store only a non-secret opt-in.

**Rely only on the model picker to hide disabled sites.** Rejected because RPC callers can name provider and model ids without using that picker. Request-time owner authorization is the security decision; catalog projection is only the user experience.

## Consequences

An administrator can expose the official DeepSeek model and several internal gateways from one process, and each ordinary user chooses whether those shared credentials apply to their projects. Keys remain centralized and independently rotatable. The design intentionally gives up arbitrary provider protocols, manual model ids, per-site user preferences, and user-authored shared routes: custom managed sites use OpenAI Chat Completions, select models returned by `/models`, share one user switch, and remain administrator-owned.
