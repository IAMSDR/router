# Fork Maintenance Guide — upstream conflict ledger

This repository is a **fork** of `9router`. Fork-only features are implemented so
that future `git rebase` / upstream merges stay mechanical. This file is the
single source of truth for **which upstream-owned files we have modified**, and
**why**. Read it before rebasing.

## Rules for fork changes

1. **New behaviour lives in new files.** Anything with real logic goes under
   `src/lib/`, `src/sse/services/`, `src/shared/utils/`, or the dashboard — never
   inside `open-sse/`.
2. **`open-sse/` is never modified.** It is the provider-agnostic engine that
   upstream publishes standalone and churns the most. All fork enforcement sits
   in the `src/sse/` glue layer. If a fork feature appears to need an `open-sse/`
   edit, prefer wrapping it from `src/`.
3. **Upstream edits are anchored one-liners.** Each insertion sits at a stable,
   greppable anchor (an existing `if (settings.requireApiKey) { ... }` block,
   an export list, a return statement). Search for the phrase
   `Fork addition` to find every one.
4. **No schema migrations.** Fork state uses the generic `kv` table via
   `makeKv(scope)`, so fork *state* never needs a migration.
   - **Exception (deliberate):** `SCHEMA_VERSION` was bumped `1 → 2` to add the
     additive `idx_uh_apikey` index on `usageHistory` for quota lookups. This is
     an upstream-owned schema divergence. The hazard: if upstream later bumps to
     its own version `2` with different content, our stored `2` would skip their
     pre-change backup. The impact is low — the version only drives that one
     safety backup, and the additive `syncSchemaFromTables()` applies the index
     regardless. On rebase, treat any upstream `schema.js` change as a conflict
     to hand-merge rather than assuming the versions line up.

### How to find every fork edit

```bash
grep -rn "Fork addition" src/
```

Every modified upstream file carries at least one `Fork addition:` comment next
to the inserted code, plus the comment block at the top of the file (where the
change is structural, e.g. a function split).

---

## Feature: Per-API-key access policy

Restrict what each API key may use — exact model / provider / combo lists (allow
or deny mode) plus RPM, tokens-per-day and concurrency quotas. Denied requests
**hard-fail** (403) and are stripped from combo fallback chains, so the gateway
never silently routes around a restriction.

### New files (zero conflict risk — upstream does not ship these)

| File | Purpose |
| --- | --- |
| `src/shared/utils/apiKeyPolicy.js` | Pure policy engine: normalize, evaluate, filter. No DB, no `node:*`. |
| `src/lib/db/repos/apiKeyPolicyRepo.js` | KV persistence (scope `apiKeyPolicies`, keyed by key **id**). |
| `src/sse/services/apiKeyPolicy/enforce.js` | Server-side enforcement: resolve key→policy, quota checks, concurrency, response shaping. |
| `src/app/api/keys/[id]/policy/route.js` | REST API for read/write/delete of a key's policy. |
| `src/app/(dashboard)/dashboard/endpoint/components/EditKeyPolicyModal.js` | Dashboard editor modal. |

### Modified upstream files (the actual conflict surface)

| File | What was added | Anchor to re-apply at |
| --- | --- | --- |
| `src/lib/db/repos/apiKeysRepo.js` | `getApiKeyByKey()`; policy cleanup inside `deleteApiKey()` | after `validateApiKey()`; inside `deleteApiKey` after the `DELETE` |
| `src/lib/db/schema.js` | `idx_uh_apikey` index on `usageHistory(apiKey)`; `SCHEMA_VERSION` 1 → 2 | `usageHistory.indexes` array; the version constant |
| `src/shared/components/AccessRulePickerModal.js` | (new file) provider/combo multi-select picker reused by the policy editor | n/a — new file |
| `src/lib/localDb.js` | 7 re-exports for the new repo | the API-keys export block |
| `src/lib/db/index.js` | repo exports; `apiKeyPolicies` in `exportDb`/`importDb` + kv-scope wipe list | export blocks / `exportDb` object / `importDb` kv loops |
| `src/lib/db/repos/settingsRepo.js` | `apiKeyPoliciesEnabled: true` default | end of `DEFAULT_SETTINGS` |
| `src/instrumentation.js` | `initApiKeyPolicies()` at boot | after `initModelCapabilities()` |
| `src/sse/handlers/chat.js` | import; pre-combo guard; combo member filtering; resolved-provider guard in `handleSingleModelChat`; `withPolicyRelease` on the 4 returns | after the `requireApiKey` block (before `detectRequiredCapabilities`); after `const { provider, model } = modelInfo` |
| `src/sse/handlers/embeddings.js` | import; guard; fallback loop extracted to `runEmbeddingFallback()` | after `const { provider, model } = modelInfo` |
| `src/sse/handlers/imageGeneration.js` | import; combo guard; solo guard; resolved guard (extra `request` param threaded through) | combo branch; `const { provider, model } = modelInfo` |
| `src/sse/handlers/tts.js` | import; combo guard; solo guard; resolved guard; `handleSingleModelTts` gains a `request` arg | same shape as image |
| `src/sse/handlers/stt.js` | import; guard after multipart parse; fallback loop extracted to `runSttFallback()` | after `const { provider, model } = modelInfo` |
| `src/sse/handlers/search.js` | import; combo guard; provider-only solo guard; resolved guard in `handleSingleProviderSearch` | combo branch; after `if (!resolvedProvider)` |
| `src/sse/handlers/fetch.js` | same as search | same as search |
| `src/sse/handlers/videoGeneration.js` | import; provider-only guard on POST; create loop extracted to `runVideoCreate()` | after `const { provider, model } = resolved` |
| `src/app/api/v1/models/route.js` | import; `filterModelsByPolicy()` + `providerAliasesForModelFilter()`; optional `policy` in `buildModelsList` options; policy resolution in `GET` | end of `buildModelsList` (before `return dedupedModels`); top of `GET` |
| `src/app/api/v1/models/[...model]/route.js` | import; policy resolution; pass `{ policy }` to both `buildModelsList` calls | top of `GET` |
| `src/app/api/v1beta/models/[...path]/route.js` | import; rules-only guard (no quota wrapping) in `forwardGeminiNativeRequest` | after the `GEMINI_NATIVE_MODEL_PATTERN` check |
| `src/app/api/keys/route.js` | `restricted` flag annotated onto each key in `GET` | inside `GET` before `NextResponse.json` |
| `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js` | `EditKeyPolicyModal` import, `policyKey` state, row button + badge, modal render | key-row JSX; end of component (next to `ConfirmModal`) |

### Semantics fixed by design (do not "fix" these on rebase)

- **Exact-string matching only.** No globs, no regex. The UI offers a
  `/v1/models`-backed picker so users select real ids.
- **Intersection.** A request must pass the provider rule *and* the model rule.
- **Combo grants its members.** An allowed combo skips the model allowlist for
  its members, but a member's provider is still checked — so a combo can never
  smuggle in a banned provider.
- **No-key requests bypass the policy.** A policy enforces whenever a presented
  key resolves to one, even when `settings.requireApiKey === false`.
- **Absent policy = unrestricted.** Existing keys are unaffected on upgrade.
- **`search` / `fetch` / `video` are provider-only.** For these, the provider
  *is* the model, so model rules are skipped (`skipModelRule`).
- **`/v1beta/models` gets rules but not quota.** It proxies the upstream body
  verbatim; wrapping it to release concurrency could corrupt the Gemini stream.
- **`/v1/models` is filtered but not quota-counted** (discovery, not generation).
- **Provider id and alias are interchangeable in both directions.** A policy may
  say `codex` or `cx`; a request or catalog id may use either form. The engine
  derives every spelling (`providerSpellingsFromModel` + the `providerAliases`
  branch of `modelCandidates`). Without this, allowing `codex/gpt-6-astra` would
  block `cx/gpt-6-astra` — the exact id the dashboard picker offers.
- **UI default is "Any"** per dimension. "Any" serializes to
  `{ mode: "allow", list: [] }`, which normalizes to *no rule* (unrestricted), so
  an untouched dimension never blocks anything.
- **Concurrency slots have a max-lifetime watchdog.** A concurrency slot is
  held for the lifetime of a streaming response (released on flush/cancel). If
  a stream hangs — client dies mid-stream and the producer never closes or
  errors — neither fires and the slot would leak until restart. A
  `MAX_STREAM_LIFETIME_MS` watchdog (default 10 min, overridable via
  `POLICY_MAX_STREAM_LIFETIME_MS`) force-releases the slot as a safety net.
- **Denied requests do not count toward the key's own RPM/token quota.**
- **RPM is per-process and counted at admission.** The requests-per-minute
  limit is kept in an in-memory trailing-60s window (`_policyRpmLog`) recorded
  at guard time, *not* derived from `usageHistory`. This means failed and
  zero-usage requests (which never reach `usageHistory`) still count, and a
  concurrent burst cannot slip past a cached read. The trade-off: the count is
  per-process and resets on restart — acceptable for a single-instance gateway
  and consistent with how the concurrency counter already behaves. If the
  gateway is ever run multi-process behind a load balancer, RPM must move to a
  shared store. Tokens-per-day remains DB-backed (it is long-lived and needs
  persisted token sums).

---

## Rebase checklist

1. `git fetch upstream && git rebase upstream/main`
2. Resolve conflicts using the anchor column above — most will be additive
   hunks (`Fork addition:` blocks) that can be re-inserted verbatim.
3. Re-run `grep -rn "Fork addition" src/` and confirm every listed file still
   contains its markers.
4. `npx eslint .`
5. `cd tests && npx vitest run unit/api-key-policy.matcher.test.js unit/api-key-policy.quota.test.js`
6. `node tests/__baseline__/verify-no-regression.mjs` (see `CLAUDE.md` — the
   suite is not expected to be all-green on a plain checkout).
