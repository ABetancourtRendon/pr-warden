# Repository metadata (for push time)

Use these values when creating the GitHub repository and configuring it.

## Repository

- **Name:** pr-warden
- **Owner:** ABetancourtRendon
- **URL:** https://github.com/ABetancourtRendon/pr-warden

## Description

Self-evaluating AI code reviewer: static analysis + LLM reasoning, severity-classified findings with suggested fix diffs, and a planted-bug benchmark that measures its own precision/recall/F1.

## Topics

- ai
- code-review
- llm
- github-action
- typescript
- agents

## Website / homepage

Leave empty (no landing page yet).

## Notes

- Default branch: `main`.
- License: MIT.
- npm package name: `pr-warden` - verified **unclaimed** on 2026-11-18 (`npm view pr-warden` returned 404 from the registry). Backups verified unclaimed at the same time: `pr-warden-cli`, `warden-review`. Re-check with `npm view pr-warden version` right before publishing.

## Ready-to-paste commands (PowerShell)

```powershell
gh repo create pr-warden --public --source=. --remote=origin --push --description "Self-evaluating AI code reviewer: static analysis + LLM reasoning with a planted-bug precision/recall benchmark"

gh repo edit --add-topic ai --add-topic code-review --add-topic llm --add-topic github-action --add-topic typescript --add-topic agents
```
