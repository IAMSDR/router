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
   - **Exception (deliberate): `open-sse/providers/capabilities.js`.** The model
     capability-override hook (`getUserCapabilityOverride`, marked with two
     `Fork addition:` comments) lives in this file. Relocation was investigated
     and rejected: `getCapabilitiesForModel` has ~25 call sites, 9 of them
     internal `open-sse/` module-to-module imports (`handlers/chatCore.js`,
     `services/combo.js`, `services/capacityAdapter.js`,
     `translator/concerns/thinkingUnified.js`, `translator/concerns/paramSupport.js`,
     `translator/formats/claude.js`, `translator/request/openai-to-claude.js`,
     `providers/thinkingLevels.js`, `executors/kiro.js`) that resolve the
     function at module-load time — there is no injection point from `src/`.
     Wrapping from `src/` would spread the violation across 9 more upstream
     files, and a `globalThis` slot would still require editing this file to
     read it. The hook is only effective at this single chokepoint. Precedent:
     upstream's own `setCatalogSource()` / `globalThis.__9rCatalogSource`
     pattern is the same kind of in-module extension.
     - **Hazard — silent regression, not a conflict.** The hook must stay
       *above every early return* in `getCapabilitiesForModel` (including the
       upstream `commandcode`/`cmc` branch). If an upstream refactor moves an
       early return above it, the override stops applying for that path with
       **no conflict marker** — it presents as a wrong capability value, not a
       broken merge. Always re-verify after a rebase with:
       `grep -n "getUserCapabilityOverride" open-sse/providers/capabilities.js`
       (as of the v0.5.86 merge: expect the import near line 44 and the guard
       near line 580, above the `if (provider === "commandcode"` branch near
       line 588 — the v0.5.81 anchor was import 37 / guard 542, so treat the
       numbers as per-merge and only the *ordering* as invariant). Covered by
       `tests/unit/capabilities-override.test.js`.
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

### Fork edits inside `open-sse/` (the deliberate exception — see rule 2)

| File | What was added | Anchor to re-apply at |
| --- | --- | --- |
| `open-sse/providers/capabilities.js` | `getUserCapabilityOverride` import + the 3-line override guard at the top of `getCapabilitiesForModel` | import block (`pricing.js` / `visionPatterns.js` imports); immediately after `if (!model) return …`, above the `commandcode`/`cmc` branch and all table lookups |
| `open-sse/providers/modelOverrides.js` | (new file) in-memory override map + `setUserCapabilityOverrides()` / `getUserCapabilityOverride()` | n/a — new file (upstream does not ship it, so zero conflict risk) |

### Fork edits outside `src/` and `open-sse/` (gitbook + CI)

Both of these diverge from upstream **on purpose**. They do not conflict (upstream
edits neither path in a way git overlaps), so a sync will silently take upstream's
version if you are not watching them.

| File | What the fork changed | Why / anchor |
| --- | --- | --- |
| `gitbook/components/LanguageSwitcher.js` | import `useEffect` instead of `useLayoutEffect`; **delete** the `useLayoutEffect(() => { setMounted(true); }, [])` block | Upstream ships both defects. (1) The body-scroll effect calls `useEffect`, which is never imported, so every static prerender dies with `ReferenceError: useEffect is not defined` — the whole `next build` fails at 0/103 pages. (2) `setMounted` names a state that is never declared and `mounted` is never read, so it would throw in the browser once the modal opened. Anchors: the `import { useState, … } from "react"` line, and the block immediately above `// Lock body scroll when modal is open`. Re-check after a sync with `git diff upstream/master HEAD -- gitbook/components/LanguageSwitcher.js`. |
| `.github/workflows/gitbook-pages.yml` | renamed `Deploy GitBook to 9router.github.io` → `Build GitBook`; job renamed `build-deploy` → `build`; the `.nojekyll` + `peaceiris/actions-gh-pages` deploy steps are removed | The deploy pushed to upstream's own `external_repository: 9router/9router.github.io` with `secrets.GH_PAGES_DEPLOY_KEY`, which this fork has never had. The job now only installs and builds the static export as a CI gate. Never re-add the deploy steps from upstream. |

> Both `capabilities.js` insertions carry a `Fork addition:` comment — that file is
> the one place `grep -rn "Fork addition" src/` will *not* find them, because the
> markers sit outside `src/`. Search the whole tree to account for every marker:
> `grep -rn "Fork addition" src/ open-sse/`.

---

## Known recurring merge conflicts (v0.5.86 sync and later)

Seven files conflict on every upstream sync. Their resolution rules:

| File | Resolution rule |
| --- | --- |
| `package.json`, `cli/package.json` | Keep the **fork** version (`0.1.x`) and the fork-only deps (e.g. `@aws-sdk/client-bedrock-runtime`). Never take upstream's `0.5.x` version — the release workflow validates tag == both package versions. |
| `CHANGELOG.md` | Keep **both** blocks: fork section first, upstream section beneath. Never discard either. |
| `Dockerfile` | Take upstream's `ALPINE_MIRROR` / `NPM_REGISTRY` / `APP_VERSION` args, conditional mirror `sed`, npm cache-mount and retry flags. Keep the fork's `apk --no-cache upgrade` (security) and `LABEL org.opencontainers.image.title="router"`. |
| `DOCKER.md` | Fork's `ghcr.io/iamsdr/router` image names and `v{version}` tag scheme are authoritative; graft upstream's mirror-arg / multi-arch / promote_latest prose onto them. Drop every `decolua/9router` reference except when explicitly describing what was stripped. |
| `.github/workflows/docker-publish.yml` | Take upstream's prepare → build (amd64+arm64 matrix) → publish structure. Strip Docker Hub entirely (`env.DOCKERHUB_IMAGE`, `publish_dockerhub` output and const, Docker Hub login/publish/promote branches). GHCR image stays `ghcr.io/${{ github.repository }}`, which resolves to `ghcr.io/iamsdr/router` automatically. Keep the fork's `v{version}` image tag (upstream tags `{version}`). |
| `src/app/api/v1/models/route.js` | Three hand-merged hunks — see below. |

### `src/app/api/v1/models/route.js` — the three anchors

1. **Imports** — union both sides: upstream's `aggregateComboCapabilities` in the
   `capabilities.js` import **and** the fork's `Fork addition:` policy imports
   (`filterModelEntries`, `normalizePolicy`, `resolveKeyPolicy`) plus the
   `_policyAliasToId` map.
2. **Static model entry (DB-down path)** — the entry keeps upstream's
   `capabilities: getCapabilitiesForModel(alias, model.id)` **and** the fork's
   async `pricing` assignment before `models.push(entry)`. Upstream writes a
   push-in-literal `});`; the fork writes `};` then pushes — take the fork's
   two-step form so `pricing` still fits.
3. **Live-catalog capability precedence** — upstream refactors to
   `liveCaps || serviceCaps || getCapabilitiesForModel(providerId, …)`. That
   ordering **loses the fork's override** (it demotes the static/override-aware
   lookup to last). Keep the fork's precedence (`staticCaps` first, which tries
   `outputAlias`, then `providerId`, then bare id forms) but may keep upstream's
   `liveCaps` / `serviceCaps` local names.

### `open-sse/providers/registry/index.js` — silent duplicate-binding hazard

This file is described as auto-generated, but **no generator is committed**, so
it is effectively hand-maintained. Its `p<N>` import aliases are number-assigned,
and upstream and the fork allocate the same next-free number independently: the
v0.5.86 sync produced `import p124 from "./qoder-cn.js"` (upstream) *and*
`import p124 from "./bedrock.js"` (fork), with two `p124` array entries.

Git auto-merges this cleanly — the lines do not overlap — and the result is a
**SyntaxError (`Identifier 'p124' has already been declared`) at module load**,
not a conflict. After every sync, check:

```bash
node -e "require('fs').readFileSync('open-sse/providers/registry/index.js','utf8')"
```

or simply count duplicate aliases (expect none):

```bash
grep -oP '^\s*import \K\w+' open-sse/providers/registry/index.js | sort | uniq -d
```

Resolution: renumber the **fork's** entry (bedrock → `p125`) and leave
upstream's newest number alone, so the next upstream sync re-applies cleanly.
Do the same scan for `open-sse/executors/index.js`, which uses named imports.

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
   (this fork currently has **no `upstream` remote** configured — fetch by URL:
   `git fetch https://github.com/decolua/9router master`, or add the remote).
2. Resolve conflicts using the anchor column above — most will be additive
   hunks (`Fork addition:` blocks) that can be re-inserted verbatim.
3. Re-run `grep -rn "Fork addition" src/ open-sse/` and confirm every listed file
   still contains its markers. **Include `open-sse/`** — the
   `capabilities.js` markers live there (rule 2's deliberate exception) and a
   `src/`-only grep reports a false "nothing missing".
4. Re-check the one hazard a conflict marker will NOT surface: the override guard
   must still sit above every early return in `getCapabilitiesForModel`:
   `grep -n 'getUserCapabilityOverride\|provider === "commandcode"' open-sse/providers/capabilities.js`
   (the guard line number must be *lower* than the `commandcode` branch).
5. `npx eslint .`
6. `cd tests && npx vitest run unit/api-key-policy.matcher.test.js unit/api-key-policy.quota.test.js unit/capabilities-override.test.js`
7. `node tests/__baseline__/verify-no-regression.mjs` (see `CLAUDE.md` — the
   suite is not expected to be all-green on a plain checkout).
