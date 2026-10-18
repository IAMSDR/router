<div align="center">
  <img src="./images/9router.png?1" alt="9Router" width="800"/>

  # 9Router Fork

  **A maintained fork of [9Router](https://github.com/decolua/9router) — a local OpenAI-compatible AI routing gateway — with extra providers, per-API-key access control, capability/pricing metadata and published Docker images.**

  [![GHCR](https://img.shields.io/badge/GHCR-iamsdr%2Frouter-blue?logo=github)](https://github.com/IAMSDR/router/pkgs/container/router)
  [![Upstream](https://img.shields.io/badge/upstream-decolua%2F9router-lightgrey)](https://github.com/decolua/9router)
  [![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

  [Quick start](#quick-start) • [What this fork adds](#what-this-fork-adds) • [Docker](#docker-recommended) • [Development](#development)
</div>

---

## About this fork

**Main repository (upstream): [decolua/9router](https://github.com/decolua/9router).**
9Router is developed there. It is a local AI gateway + dashboard that exposes one
OpenAI-compatible endpoint (`/v1/*`) and routes across 40+ providers with format
translation, model-combo fallback, multi-account fallback, OAuth/API-key credential
management, token refresh, quota tracking and RTK token saving. Provider lists,
video guides and the full FAQ live in the upstream repo.

This repository — **[IAMSDR/router](https://github.com/IAMSDR/router)** — is a fork
that only adds the items listed below.

| | |
| --- | --- |
| **Versioning** | Fork releases are `0.1.x`, independent of upstream's `0.5.x`. The upstream baseline is recorded inside [`CHANGELOG.md`](./CHANGELOG.md). |
| **Syncing** | Upstream `master` is merged in regularly. Fork release notes come first in `CHANGELOG.md`; upstream's own release notes follow underneath. |
| **Maintenance map** | [`docs/FORK.md`](./docs/FORK.md) lists every fork edit, the anchor to re-apply it at, and the conflict rules for the next sync. |

---

## What this fork adds

Everything not in this table (routing, RTK, combos, providers, dashboard…) is
upstream 9Router.

| Addon | Description |
| --- | --- |
| **Per-API-key access policies** | Restrict an API key to exact model / provider / combo lists (allow or deny mode) plus RPM, tokens-per-day and concurrency quotas. Violations hard-fail with `403` and are stripped from combo fallback chains, so the gateway never routes around a restriction. Includes a dashboard editor. |
| **Amazon Bedrock (OC) provider** | Fork-owned `oc-bedrock` provider (alias `broc`) alongside upstream's `bedrock`: a single Bedrock API key (bearer token), automatically resolved region (default `us-east-1`, `AWS_REGION` override), and the full OpenCode model catalogue (`models.opencode.ai`, ~199 models) fetched live with a curated seed fallback. Talks to the model-agnostic Converse API via `@aws-sdk/client-bedrock-runtime`, so Claude, Nova, Llama, Mistral and xAI Grok all work through one entry; cross-region inference profiles (`us.`/`eu.`/`apac.`/`jp.`/`au.`/`global.`) are resolved from the bare model id. Upstream's `bedrock` (SigV4 / AWS SSO) is left untouched. |
| **Chat page** | A dashboard `Chat` page for testing the gateway with real conversations. It talks to the fork's own `/v1` chat path, so routing, combos, fallback chains, quotas and request logging are all exercised; sessions live server-side in SQLite (shared across the dashboard, not per-browser). Streams replies with the resolved model, token usage, cost, latency and TTFT, keeps reasoning in a collapsible block, and offers a model + combo picker with search, a system prompt with an advanced-params drawer, per-message copy / edit & resend / regenerate / delete, and vision attachments (PNG/JPEG/WebP/GIF up to 5 MB) stored under `<DATA_DIR>/chat-uploads`. Markdown renders with plain monospace code blocks and a Copy button, and Settings → *Image cache* clears the stored images. |
| **Model capability overrides** | Per-model capability tuning (vision, context window, tools, reasoning…) stored in SQLite and applied to `/v1/models` and routing, without touching upstream's capability tables. |
| **Pricing on `/v1/models`** | OpenRouter-compatible `pricing` on every listed model — per-token strings (`prompt`/`completion`) and numeric `$/1M` values (`input`/`output`). |
| **Free provider auto-inclusion** | Active `noAuth` free providers are always kept in the model list even when they have no stored connection. |
| **Docker images on GHCR** | Multi-arch images (`linux/amd64` + `linux/arm64`) published to `ghcr.io/iamsdr/router`. |
| **Release workflow** | A pushed `v*` tag is validated against both package versions, built for both architectures, health-checked and smoke-tested, then published as `:v{version}` + `:latest`. Docker Hub publishing is stripped — GHCR only. |
| **GitBook build fix** | Fixed an upstream `ReferenceError` that broke the docs static build. The docs workflow here only builds; it does not deploy upstream's site. |

Per-release detail: [`CHANGELOG.md`](./CHANGELOG.md).

---

## Quick start

### Docker (recommended)

```bash
docker run -d \
  --name router \
  --restart always \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  -e NODE_ENV=production \
  ghcr.io/iamsdr/router:latest
```

Dashboard: http://localhost:20128 — full container documentation in [`DOCKER.md`](./DOCKER.md).

### From source

```bash
git clone https://github.com/IAMSDR/router.git
cd router
cp .env.example .env
npm install
npm run dev        # dev server → http://localhost:20127
```

Production:

```bash
npm run build
PORT=20128 HOSTNAME=0.0.0.0 npm run start
```

### Point a tool at it

```
Endpoint: http://localhost:20128/v1
API Key:  (copy from the dashboard)
Model:    <provider>/<model>
```

> The npm CLI package [`9router`](https://www.npmjs.com/package/9router) is published
> by upstream and does **not** contain this fork's changes. Use the Docker image or
> run from this source tree instead.

---

## Development

```bash
npm install          # root dependencies
npm run dev          # dev server on http://localhost:20127
npm run build        # production build
npx eslint .         # lint (eslint.config.mjs)
```

Tests live in `tests/` as an independent package:

```bash
cd tests && npm install
npx vitest run                          # whole suite
npx vitest run unit/capabilities.test.js  # single file
```

> The suite is **not** expected to be all-green on a plain checkout — judge
> regressions with the committed baselines (`tests/__baseline__/verify-*.mjs`),
> not a raw run. See `CLAUDE.md` for the detailed workflow.

Docs site (static export in `gitbook/`):

```bash
cd gitbook && npm install && npm run build   # output → gitbook/out
```

---

## Releasing

```bash
git tag v0.1.9
git push origin v0.1.9
```

The `Build and Push Docker Image` workflow validates the tag, builds both
architectures and publishes `ghcr.io/iamsdr/router:v0.1.9` and `:latest`.

---

## Translations

The translated READMEs under [`i18n/`](./i18n/) and `README.zh-CN.md` come from
upstream and describe upstream 9Router — they do not include this fork's additions.

---

## License & credits

MIT — see [`LICENSE`](./LICENSE).

9Router is created and maintained by [decolua](https://github.com/decolua/9router)
and contributors. This fork only adds the changes listed above.
