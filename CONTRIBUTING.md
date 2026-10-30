# Contributing

Thanks for helping. This is a small project; keep changes focused.

## Setup

Requires Node.js 22.13 or newer (`node:sqlite` is used unflagged).

```sh
npm ci
npm run dev        # tsx src/index.ts, serves on http://localhost:3000
npm test           # vitest run
npm run typecheck  # tsc --noEmit
npm run build      # compile to dist/
```

## Workflow

- Write the test first, watch it fail, then make it pass. Bug fixes need a regression test.
- Integration tests run against the Hono app with an in-memory database; do not hit the network in tests.
- Use conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`.
- Run `npm run typecheck && npm test` before opening a PR.

## Where things live

- Design spec: `docs/superpowers/specs/`
- Implementation plans: `docs/superpowers/plans/`
- User docs: `docs/recipe-format.md`, `docs/api.md`

Changes to deep-link formats or the recipe shape must stay consistent with the facts in the design spec.
