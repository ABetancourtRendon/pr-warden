# SETUP.md - local development and publishing guide

## Prerequisites

- Node.js 20 or newer (`node -v`)
- pnpm 9 - enable once per machine: `corepack enable` (PowerShell: run as normal user; if corepack is unavailable, use `npm install -g pnpm@9`)
- A free Google AI Studio key (you already have one: https://aistudio.google.com) and/or an OpenRouter key (https://openrouter.ai)
- Optional: a GitHub token (`GITHUB_TOKEN`) to raise API rate limits and post reviews

## First run

```bash
git clone https://github.com/ABetancourtRendon/pr-warden
cd pr-warden
pnpm install
pnpm test        # 131 tests, no network, mock provider only
```

PowerShell equivalent:

```powershell
git clone https://github.com/ABetancourtRendon/pr-warden
cd pr-warden
corepack enable          # or: npm install -g pnpm@9
pnpm install
pnpm test
```

## Configuring the LLM provider

All LLM traffic goes through one thin OpenAI-compatible adapter. Configure via environment variables or a `.env` file (copy `.env.example` to `.env`; `.env` is gitignored).

**Default preset: Google Gemini** (free tier, key from Google AI Studio):

```bash
export LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
export LLM_API_KEY=your-key
export LLM_MODEL=gemini-2.5-flash
```

```powershell
$env:LLM_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
$env:LLM_API_KEY = "your-key"
$env:LLM_MODEL = "gemini-2.5-flash"
```

**Alternative: OpenRouter** (you already have a key):

```powershell
$env:LLM_BASE_URL = "https://openrouter.ai/api/v1"
$env:LLM_API_KEY = "your-openrouter-key"
$env:LLM_MODEL = "google/gemini-2.5-flash"
```

Other presets (openai, anthropic, groq) and precedence rules are documented in README.md under Configuration.

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm dev -- review --repo owner/name --pr 123` | Run a review from source with your env vars |
| `pnpm dev -- review --repo owner/name --pr 123 --post` | Also post the review to the PR (needs `GITHUB_TOKEN` with pull-requests:write) |
| `pnpm dev -- review --repo owner/name --pr 123 --json` | Machine-readable output |
| `pnpm dev -- review --repo owner/name --pr 123 --provider mock` | Fully offline review (mock LLM, real static analysis) |
| `pnpm test` | Full test suite (no live LLM calls, recorded fixtures) |
| `pnpm lint` / `pnpm format` | Biome lint / lint with safe fixes |
| `pnpm typecheck` | `tsc --noEmit` over the whole source |
| `pnpm build` | Build `dist/` with tsup (bin: `node bin/pr-warden.js`) |
| `pnpm bench` | Run the real benchmark and rewrite `docs/BENCH.md` (needs `LLM_API_KEY`) |
| `pnpm bench:ci` | Deterministic scorer assertion against recorded mock outputs |
| `pnpm bench:freeze` | Re-freeze `bench/recordings/expected.json` after an intentional scorer/recording change |

## Running the real benchmark

`pnpm bench` runs the full review pipeline over `bench/fixtures/*` with your provider, scores findings against each fixture's `manifest.json`, and rewrites `docs/BENCH.md` with measured precision/recall/F1 (overall, per category, per fixture, plus missed-bug and false-positive lists).

```powershell
$env:LLM_API_KEY = "your-gemini-key"
pnpm bench
git add docs/BENCH.md
git commit -m "docs: add measured benchmark results"
```

CI (`pnpm bench:ci`) never calls a live LLM: it replays recorded MockProvider outputs through the real static-analysis pass and asserts the exact metrics, so the scorer itself stays deterministic.

## Publishing to npm (user-side step)

The npm name **`pr-warden`** was verified unclaimed at build time (registry returned 404 on 2026-11-18; re-verify with `npm view pr-warden version` before publishing). If it is taken when you publish, the same check confirmed `pr-warden-cli` and `warden-review` are also free - rename `name` in `package.json`, then update the two `npx` references in README/action docs.

```powershell
npm login                       # uses your npmjs.com account
npm version 0.1.0               # if not already
npm publish --access public
npm view pr-warden version      # verify it landed
```

After publishing, `npx pr-warden@latest review ...` and the composite GitHub Action (`action.yml`, which installs the package from npm) become usable in any repository. This repo's own dogfooding workflow (`.github/workflows/warden.yml`) runs from source and needs no publish.

## Repository layout

```
src/            review pipeline, LLM adapter, static runners, bench harness, CLI
bench/fixtures  5 planted-bug fixture projects (manifest.json per fixture)
bench/recordings  recorded MockProvider outputs + frozen expected metrics for CI
test/fixtures   recorded GitHub API fixtures for integration tests
docs/           BENCH.md (benchmark output), repo-meta.md (repo description/topics)
action.yml      composite GitHub Action
```

## Troubleshooting

- **"LLM disabled: LLM_API_KEY is not set"** - the review ran static-only. Set the variable (or create `.env`) and rerun.
- **Review posting fails with 403/401** - `GITHUB_TOKEN` missing or lacking pull-requests:write; the review still completes locally.
- **GitHub rate limits (403)** - unauthenticated public-repo access allows ~60 req/hr; set `GITHUB_TOKEN`.
- **`pnpm bench` refuses to run without a key** - deliberate, so static-only numbers are never written as real results.
