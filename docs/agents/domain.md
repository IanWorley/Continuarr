# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root.
- **`docs/internals/`**: read the pages that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## Decisions live in `docs/internals/`, not `docs/adr/`

This repo records architectural decisions and their reasons in `docs/internals/`. Some skills say ADRs live in `docs/adr/`. In this repo, read that as `docs/internals/`:

- Never create `docs/adr/`.
- When a skill says to write an ADR, add or rewrite a page in `docs/internals/` instead. Follow [Documentation in `AGENTS.md`](../../AGENTS.md#documentation): no sequential numbering, and rewrite a changed decision in place rather than appending a new one.

## File structure

Single-context repo:

```
/
├── GLOSSARY.md
├── docs/internals/
├── backend/
└── frontend/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag decision conflicts

If your output contradicts a decision recorded in `docs/internals/`, surface it explicitly rather than silently overriding:

> _Contradicts `docs/internals/<page>.md` (why we chose X), but worth reopening because…_
