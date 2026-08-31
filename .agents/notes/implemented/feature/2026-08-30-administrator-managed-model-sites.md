# Agent Note: Administrator-managed model sites

Status: implemented

English | [中文](2026-08-30-administrator-managed-model-sites.zh.md)

## Problem

The multi-user Web server offered one administrator credential for one fixed DeepSeek model. An intranet deployment can also have an OpenAI-compatible gateway such as New API, but ordinary users cannot safely share its key through personal settings or process environment variables. A model route shown to every user without request-time authorization would also let a user bypass the preference switch by constructing an RPC request directly.

## Decision

The system settings page keeps the fixed `deepseek-official/deepseek-v4-flash` site and lets an administrator add up to 32 custom OpenAI Chat Completions-compatible sites. After the administrator enters an HTTP or HTTPS Base URL and API key, the Host uses pi-ai model discovery to request that site's `/models` endpoint and offers the returned models for selection. Each custom site stores a display name, a Base URL without credentials, query, or fragment, and up to 32 selected model ids. The Host assigns a random twelve-hexadecimal site id and reserves the corresponding `managed-<site id>` pi-ai provider route.

Every site has its own server-side credential reference. The official site uses `HARNESS_SHARED_DEEPSEEK_API_KEY`; a custom site uses `HARNESS_SHARED_MODEL_<SITE ID>_API_KEY`. HTTP responses expose only whether a credential is configured and writable. Creating a custom site writes its credential before its profile and removes the credential if the settings provider refuses the profile. Removing a site removes both records. An opted-in official Flash session uses the same official-site key for its DeepSeek LLM request and for auxiliary DeepSeek web search.

One existing per-user preference authorizes all administrator-managed sites. The Gateway removes custom managed routes from an ordinary user's model catalog unless that user has opted in and the site credential is configured. The pi-ai, dedicated DeepSeek, and DeepSeek search credential resolvers independently resolve the live Session's project owner and refuse a managed credential when that owner has not opted in. Discovery can describe a route without a Session but cannot use its credential for generation or search.

The reserved route and credential grammar distinguishes this policy from ordinary pi-ai deployment profiles. In an authenticated user Session, a non-managed `apiKeyEnv` resolves only from that owner's private reference scope; outside the authenticated carrier it retains the process credential behavior. The existing DeepSeek adapter retains its dedicated managed-Flash authorization. The multi-user Model sources page lets a user rotate only the personal `DEEPSEEK_API_KEY` needed by the official route and DeepSeek search; administrators still own endpoint and catalog configuration.

## Verification

Host route tests cover official-site credential replacement, custom-site discovery, creation, update, deletion, input validation, administrator-only mutation, per-user credential isolation, and non-disclosure of submitted keys. Gateway tests cover opted-out catalog removal, fallback selection, and owner-only credential operations and events. Pi-ai, dedicated DeepSeek, and search composition tests prove that a request selects the Session owner's personal or explicitly enabled shared key. Client tests cover automatic discovery, administrator model selection, ordinary-user activation, and write-only personal DeepSeek credential rotation.

## Alternatives considered

**Replace the official DeepSeek site with one generic custom-site record.** Rejected because the official route has a dedicated adapter, known endpoint, fixed product model, and existing credential data. Keeping it preserves the direct DeepSeek behavior while custom sites use the generic pi-ai adapter.

**Store one shared key and Base URL in each user's settings.** Rejected because browser-visible or per-user copies multiply secret exposure and rotation work. The administrator owns one credential per site, while users store only a non-secret opt-in.

**Rely only on the model picker to hide disabled sites.** Rejected because RPC callers can name provider and model ids without using that picker. Request-time owner authorization is the security decision; catalog projection is only the user experience.

## Consequences

An administrator can expose the official DeepSeek model and several internal gateways from one process, and each ordinary user chooses whether those shared credentials apply to their projects. The official shared key authorizes both Flash generation and its native web search; with shared models disabled, the user's private `DEEPSEEK_API_KEY` authorizes both instead. Those two operations therefore cannot drift onto different credential owners. Shared keys remain centralized and independently rotatable, while private keys remain isolated by opaque user id. The design intentionally gives up arbitrary provider protocols, manual model ids, per-site user preferences, and user-authored shared routes: custom managed sites use OpenAI Chat Completions, select models returned by `/models`, share one user switch, and remain administrator-owned.
