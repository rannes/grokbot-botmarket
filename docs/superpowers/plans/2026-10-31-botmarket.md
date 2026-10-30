# BotMarket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hosted web marketplace for Grok Bot bots where every listing adds itself to the visitor's Grok Bot in one click.

**Architecture:** A single Node 22 process: Hono app with server-rendered JSX pages and a JSON API, backed by `node:sqlite`. Pure library modules under `src/core` (link parsing, recipe validation, prompt building, metadata fetch, catalog) are framework-free and unit-tested; `src/routes` wire them to HTTP; `src/db` holds the repository. One CLI entry serves the app or imports/exports catalogs.

**Tech Stack:** TypeScript (ESM), Hono + `@hono/node-server`, `hono/jsx` SSR, `node:sqlite`, Zod, `marked` + `sanitize-html`, Vitest, Docker, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-31-botmarket-design.md`

## Global Constraints

- Node.js `>=22.13.0` (unflagged `node:sqlite`); `"type": "module"`; TypeScript `strict`.
- No frontend bundler; no native npm dependencies.
- Template id regex `^[A-Za-z0-9_-]{21}$`; template deep link `grokbot://app/v1/bot-template?id=<id>`; universal link `https://cursor.com/grok-bot/link/v1/bot-template?id=<id>`; page `https://x.ai/bot/<id>`; prompt deep link `grokbot://app/v1/prompt?text=<encoded>` with decoded text non-empty and ≤1000 chars; deep links built only from validated values.
- Recipe limits: profile name ≤200, description ≤20000, ≤200 memory, ≤64 skills, ≤100 routines, ≤40 plugins, ≤2 MB, forbidden keys `__proto__`, `constructor`, `prototype`.
- Bot fields: slug `^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`, tagline ≤200, description_md ≤20000, ≤10 tags each ≤32 chars, category ∈ `engineering, sales, marketing, design, personal, recruiting-people, product, operations, other`; a bot needs `templateId` or `recipe`.
- Env: `PORT`=3000, `BOTMARKET_DATA_DIR`=`./data`, `BOTMARKET_ADMIN_TOKEN` (optional), `BOTMARKET_REQUIRE_APPROVAL`=`false`, `BOTMARKET_SITE_NAME`=`BotMarket`, `BOTMARKET_PUBLIC_URL` (optional).
- Markdown output sanitized; image URLs `https:` only; CSP header on HTML responses; no inline event handlers.
- Commit after every task with a conventional-commit message.

## Review Focus

1. A pasted link with tracking params or trailing slash (`https://x.ai/bot/<id>/?utm_source=x`) must still resolve to the id. → Task 2 test `accepts trailing slash and query noise`.
2. A recipe pasted from a bot's own export where `memory` is a plain string must import, not fail. → Task 3 test `accepts memory as a bare string`.
3. A submission for a slug that already exists must get a `-2` suffix, never overwrite. → Task 7 test `insert with duplicate slug gets a numeric suffix`.
4. `/add/:slug` on a pending (unapproved) bot must 404, not leak the deep link. → Task 10 test `does not redirect for pending bots`.
5. x.ai metadata fetch failing (network down, 500, non-JSON) must leave the submit form usable with empty fields, not crash. → Task 5 test `returns null on non-2xx or invalid JSON`; Task 9 test `lookup failure renders form with warning`.

---

### Task 1: Project skeleton

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.editorconfig`, `LICENSE` (MIT), `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env?: NodeJS.ProcessEnv): Config` where `Config = { port: number; dataDir: string; dbPath: string; adminToken: string | null; requireApproval: boolean; siteName: string; publicUrl: string | null }`. `dbPath = join(dataDir, 'botmarket.sqlite')`; `publicUrl` has no trailing slash.

- [ ] Step 1: `package.json` with name `grokbot-botmarket`, version `0.1.0`, `"type":"module"`, `bin: {"grokbot-botmarket":"dist/index.js"}`, `engines.node ">=22.13.0"`, scripts `dev` (`tsx src/index.ts`), `build` (`tsc -p tsconfig.json && cp -R src/public dist/public`), `start` (`node dist/index.js`), `test` (`vitest run`), `typecheck` (`tsc --noEmit`). Deps: `hono`, `@hono/node-server`, `zod`, `marked`, `sanitize-html`. Dev: `typescript`, `tsx`, `vitest`, `@types/node`, `@types/sanitize-html`.
- [ ] Step 2: `tsconfig.json`: `target ES2022`, `module NodeNext`, `moduleResolution NodeNext`, `jsx react-jsx`, `jsxImportSource hono/jsx`, `strict`, `outDir dist`, `rootDir src`, `include ["src"]`.
- [ ] Step 3: Write `tests/config.test.ts`: `loadConfig({})` gives port 3000, siteName `BotMarket`, requireApproval false, adminToken null; `loadConfig({PORT:'8080', BOTMARKET_REQUIRE_APPROVAL:'true', BOTMARKET_PUBLIC_URL:'https://m.example/'})` gives 8080, true, `https://m.example`.
- [ ] Step 4: Run `npx vitest run tests/config.test.ts` → FAIL (module missing).
- [ ] Step 5: Implement `src/config.ts`.
- [ ] Step 6: Run tests → PASS. `npm run typecheck` → clean.
- [ ] Step 7: Commit `chore: project skeleton and config`.

### Task 2: Template link parsing and deep-link building

**Files:**
- Create: `src/core/template-link.ts`
- Test: `tests/template-link.test.ts`

**Interfaces:**
- Produces: `TEMPLATE_ID_RE`, `parseTemplateRef(input: string): string | null`, `templateDeepLink(id)`, `templateUniversalLink(id)`, `templatePageUrl(id)`, `promptDeepLink(text: string): string` (throws `RangeError` when trimmed text is empty or decoded length > 1000). All builders throw `TypeError` on an id failing the regex.

- [ ] Step 1: Tests: bare id; `https://x.ai/bot/<id>`; `https://www.x.ai/bot/<id>/`; `accepts trailing slash and query noise`; `grokbot://app/v1/bot-template?id=<id>&open=1`; `sand://app/v1/bot-template?id=<id>`; `https://cursor.com/grok-bot/link/v1/bot-template?id=<id>`; `https://cursor.com/sand/link/v1/bot-template?id=<id>`; rejects: 20-char id, `https://x.ai/bot/marketplace/bots/foo`, `https://evil.com/bot/<id>`, URL with userinfo, URL with port, URL with `#frag`, input > 2048 chars, `https://x.ai/bot/<id>/extra`. Builders produce exact strings from Global Constraints; `promptDeepLink('a'.repeat(1001))` throws; `promptDeepLink('  ')` throws; `promptDeepLink('hi there')` → `grokbot://app/v1/prompt?text=hi%20there`.
- [ ] Step 2: Run → FAIL. Step 3: Implement with `URL.canParse`/`new URL`. Step 4: Run → PASS. Step 5: Commit `feat(core): template link parsing and deep links`.

### Task 3: Recipe schema and normalization

**Files:**
- Create: `src/core/recipe.ts`
- Test: `tests/recipe.test.ts`

**Interfaces:**
- Produces: `type Recipe = { format: 'grokbot-recipe/v1'; profile: { name: string; description: string; avatarShape?: string; avatarColor?: string }; memory: { content: string; kind?: 'profile'|'log'; createdAt?: string }[]; skills: { name: string; description?: string; content: string }[]; routines: { name: string; description?: string; content: string; schedule?: string; timezone?: string; enabled?: boolean }[]; plugins: { pluginId?: string; name: string; description?: string }[]; gettingStarted?: { skill: string }; setupNotes?: string }`; `parseRecipe(input: unknown): { ok: true; recipe: Recipe } | { ok: false; errors: string[] }`; `parseRecipeText(text: string)` (JSON.parse + size check 2 MB); `recipeCounts(r): { memory: number; skills: number; routines: number; plugins: number }`.

- [ ] Step 1: Tests: minimal `{profile:{name,description}}` → ok with empty arrays and format set; `accepts memory as a bare string` → one memory item; array of strings; skill `body` alias; routine `prompt` alias; `grokbot-bundle/v1` example from spec converts (persona→profile, `text`→content, `prompt`→content, `id`→pluginId); rejects name > 200, > 64 skills, key `__proto__` anywhere, missing profile, non-object; `parseRecipeText` rejects > 2 MB and invalid JSON with readable errors; `recipeCounts`.
- [ ] Steps 2–5 as TDD cycle; commit `feat(core): grokbot recipe schema`.

### Task 4: Install prompt, slug, categories, markdown

**Files:**
- Create: `src/core/install-prompt.ts`, `src/core/slug.ts`, `src/core/categories.ts`, `src/core/markdown.ts`
- Test: `tests/install-prompt.test.ts`, `tests/slug.test.ts`, `tests/markdown.test.ts`

**Interfaces:**
- `buildRecipeInstallPrompt({ recipeUrl: string; name: string }): string` — ≤1000 chars; must contain the URL and the bot name; instructs: fetch the JSON, show the user a short summary (memories/skills/routines/plugins counts), ask before continuing, then write memories as journal memories, write skills, create routines paused, and ask with one question before installing any plugin; never install plugins or MCP servers silently.
- `slugify(name: string): string` (lowercase, non `[a-z0-9]` runs → `-`, trim `-`, ≤64, fallback `bot`).
- `CATEGORIES: readonly { id: Category; label: string }[]`, `isCategory(x): x is Category`.
- `renderMarkdown(md: string): string` using `marked` then `sanitize-html` allowing `p, br, strong, em, code, pre, ul, ol, li, a[href https|http|mailto], h2–h4, blockquote, hr, table parts`; `a` gets `rel="nofollow noopener" target="_blank"`.

- [ ] Tests: prompt length with a 300-char URL still ≤1000; contains url; `slugify('  Release Notes Bot! ')` → `release-notes-bot`; `slugify('!!!')` → `bot`; markdown strips `<script>` and `onclick`, keeps links with rel/target, drops `javascript:` hrefs.
- [ ] TDD cycle; commit `feat(core): install prompt, slug, categories, markdown`.

### Task 5: x.ai template metadata fetch

**Files:**
- Create: `src/core/xai-metadata.ts`
- Test: `tests/xai-metadata.test.ts`

**Interfaces:**
- `type TemplateMetadata = { id: string; name: string; description: string; avatarShape: string | null; avatarColor: string | null; imageUrl: string | null; published: boolean }`
- `fetchTemplateMetadata(id: string, fetchImpl: typeof fetch = fetch): Promise<TemplateMetadata | null>`: first `POST https://api2.cursor.sh/aiserver.v1.GrokBotService/GetPublicGrokBotTemplate` (headers `Content-Type: application/json`, `Connect-Protocol-Version: 1`, body `{"shareId":id}`, 5 s `AbortSignal.timeout`); on success map `template.*`, `imageUrl = https://x.ai/bot/<id>/opengraph-image` is NOT guessed — fetch the page `https://x.ai/bot/<id>` only when the API fails, parse `og:title`, `og:description`, `og:image` with regex over the first 512 KB. Throws `TypeError` for invalid id.

- [ ] Tests with injected fake fetch: API success maps fields (use the live JSON from the spec as fixture); `returns null on non-2xx or invalid JSON` when both API and page fail; page fallback parses og tags; rejects bad id.
- [ ] TDD cycle; commit `feat(core): fetch template metadata from x.ai`.

### Task 6: Database and migrations

**Files:**
- Create: `src/db/database.ts`, `src/db/migrations.ts`
- Test: `tests/database.test.ts`

**Interfaces:**
- `openDatabase(path: string): DatabaseSync` (from `node:sqlite`), runs `migrate(db)`; `':memory:'` supported; sets `PRAGMA journal_mode=WAL` (skip for memory), `foreign_keys=ON`.
- Tables: `bots(slug TEXT PK, name, tagline, description_md, category, tags_json, author_name, author_url, avatar_shape, avatar_color, image_url, template_id, recipe_json, source_url, homepage_url, status, featured INTEGER, install_clicks INTEGER, upvotes INTEGER, created_at, updated_at)`, `events(id INTEGER PK, slug, kind, visitor_hash, day, UNIQUE(slug, kind, visitor_hash, day))`, `settings(key TEXT PK, value)`, `schema_migrations(version INTEGER PK)`.

- [ ] Test: opening memory db twice is idempotent; tables exist via `sqlite_master`.
- [ ] TDD cycle; commit `feat(db): sqlite schema and migrations`.

### Task 7: Bots repository

**Files:**
- Create: `src/db/bots-repo.ts`, `src/db/visitor.ts`
- Test: `tests/bots-repo.test.ts`

**Interfaces:**
- `type Bot = { slug; name; tagline; descriptionMd; category: Category; tags: string[]; authorName: string; authorUrl: string | null; avatarShape: string | null; avatarColor: string | null; imageUrl: string | null; templateId: string | null; recipe: Recipe | null; sourceUrl: string | null; homepageUrl: string | null; status: 'published' | 'pending'; featured: boolean; installClicks: number; upvotes: number; createdAt: string; updatedAt: string }`
- `type NewBot = Omit<Bot, 'installClicks' | 'upvotes' | 'createdAt' | 'updatedAt' | 'featured' | 'status' | 'slug'> & { slug?: string; status?: Bot['status']; featured?: boolean }`
- `class BotsRepo { constructor(db: DatabaseSync); list(opts?: { status?: Bot['status'] | 'all'; category?: Category; q?: string; sort?: 'new' | 'top' | 'installs'; featured?: boolean; limit?: number; offset?: number }): Bot[]; count(opts?): number; get(slug: string): Bot | null; insert(bot: NewBot): Bot; update(slug, patch: Partial<NewBot>): Bot | null; delete(slug): boolean; setStatus(slug, status): void; setFeatured(slug, featured: boolean): void; recordEvent(slug, kind: 'install' | 'upvote', visitorHash: string): boolean; categoryCounts(): Record<Category, number>; upsertFromCatalog(bot: NewBot & { slug: string }): Bot }`
- `visitorHash(ip: string, salt: string, date = new Date()): string` → sha256 hex of `ip|salt|YYYY-MM-DD`.

- [ ] Tests: insert/get round-trip including recipe JSON and tags; `insert with duplicate slug gets a numeric suffix` (`foo`, `foo-2`, `foo-3`); `list` default returns only published, newest first; `q` matches name/tagline/tags case-insensitively; `sort:'installs'`; `recordEvent` returns true once per hash/day and increments the counter; `categoryCounts`; `upsertFromCatalog` updates existing slug.
- [ ] TDD cycle; commit `feat(db): bots repository`.

### Task 8: Catalog export/import

**Files:**
- Create: `src/core/catalog.ts`
- Test: `tests/catalog.test.ts`

**Interfaces:**
- `CATALOG_FORMAT = 'botmarket-catalog/v1'`; `type Catalog = { format; generatedAt: string; site: { name: string; url: string | null }; bots: CatalogBot[] }` where `CatalogBot` = public `Bot` fields minus `status/featured/installClicks/upvotes` plus `installUrl` (deep link or null) and `pageUrl` (x.ai or null).
- `exportCatalog(bots: Bot[], site): Catalog`; `parseCatalog(input: unknown): { ok: true; catalog: Catalog } | { ok: false; errors: string[] }` (bot entries validated with the same field rules; recipe via `parseRecipe`).

- [ ] Tests: round-trip export→parse equals; rejects wrong format; rejects bot without template or recipe.
- [ ] TDD cycle; commit `feat(core): catalog export and import`.

### Task 9: App wiring, layout, public pages, submit flow

**Files:**
- Create: `src/app.tsx` (`createApp(deps: { repo: BotsRepo; config: Config; fetchMetadata?: typeof fetchTemplateMetadata; now?: () => Date })` → Hono), `src/views/layout.tsx`, `src/views/components.tsx` (`BotAvatar`, `BotCard`, `InstallButtons`, `RecipeSections`, `CategoryChips`), `src/routes/pages.tsx`, `src/routes/submit.tsx`, `src/public/styles.css`, `src/public/app.js`, `src/core/rate-limit.ts` (`class RateLimiter { constructor(limit: number, windowMs: number); allow(key: string, now?: number): boolean }`), `src/core/validation.ts` (Zod `BotInputSchema` for form/API fields; `botFromInput()`).
- Test: `tests/app.test.ts`, `tests/rate-limit.test.ts`

**Behavior:**
- `GET /` lists published bots (featured first row), search box, category chips with counts. `GET /bots/:slug` 404 for unknown or pending (unless admin cookie). Detail page shows `InstallButtons`: for `templateId` a primary `<a href="grokbot://app/v1/bot-template?id=…">Add to Grok Bot</a>` routed through `/add/:slug`, secondary "Open on x.ai", details toggle with universal link; for recipe: primary `/add/:slug` → prompt deep link, "Copy setup prompt", "Download recipe". Page `<head>` has `og:title`, `og:description`, `og:image` (image_url or `/badge/:slug.svg`-independent default), `og:url`.
- `GET /submit` form; `POST /submit/lookup` (form field `ref`) → re-renders form prefilled from `fetchTemplateMetadata` or with a warning (`lookup failure renders form with warning`); `POST /submit` validates with `BotInputSchema`, status = `requireApproval ? 'pending' : 'published'`, slug from `slugify(name)`, redirect `303` to `/bots/:slug` or `/submitted`. Submissions rate-limited 10/hour per IP (`x-forwarded-for` first hop else socket).
- `GET /c/:category`, `GET /search?q=`.
- Security headers middleware: CSP `default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; form-action 'self'`, `X-Content-Type-Options`, `Referrer-Policy`.
- `src/public/app.js`: copy-to-clipboard buttons, details toggles, "Add" click telemetry only via navigation (no fetch).

- [ ] Tests (via `app.request`): `/` 200 contains site name and a seeded bot name; `/bots/:slug` contains the exact deep link href; pending bot → 404; `/submit/lookup` with fake metadata prefills name; lookup null → warning text; `POST /submit` creates bot and redirects; invalid category → 400 re-render; rate limiter unit test.
- [ ] Commit `feat(web): pages, layout, submit flow`.

### Task 10: Install redirect, badge, JSON API

**Files:**
- Create: `src/routes/install.ts`, `src/routes/api.ts`
- Test: `tests/install-api.test.ts`

**Behavior:**
- `GET /add/:slug` → 302 to template deep link (or prompt deep link for recipe bots), records `install` event; `?via=web` → 302 to `https://x.ai/bot/<id>` (template bots only); `does not redirect for pending bots` (404).
- `GET /badge/:slug.svg` → `image/svg+xml` flat badge "Add to Grok Bot", `Cache-Control: public, max-age=3600`.
- `GET /api/bots` (`q, category, sort, limit≤100, offset`) → `{ bots: CatalogBot[], total }`; `GET /api/bots/:slug` → CatalogBot; `GET /api/bots/:slug/recipe.json` → normalized recipe or 404; `POST /api/bots` JSON body (`BotInputSchema`) → 201 CatalogBot (same approval rule and rate limit); `POST /api/bots/:slug/upvote` → `{ upvotes }`; `GET /catalog.json` → `exportCatalog`; `GET /healthz` → `{ ok: true }`.

- [ ] Tests for each route incl. 404s and the pending case; `POST /api/bots` with recipe only works; with neither → 400.
- [ ] Commit `feat(web): install redirect, badge, json api`.

### Task 11: Admin

**Files:**
- Create: `src/routes/admin.tsx`, `src/core/admin-auth.ts` (`signAdminCookie(token, secret)`, `verifyAdminCookie`), modify `src/app.tsx`
- Test: `tests/admin.test.ts`

**Behavior:** If `adminToken` null → all `/admin*` 404. `GET /admin` login form; `POST /admin/login` (field `token`) sets `HttpOnly; SameSite=Lax` cookie `bm_admin` = HMAC(token) and redirects to `/admin`; `GET /admin` lists pending + published with actions; `POST /admin/bots/:slug/approve|feature|unfeature|delete`; `POST /admin/import` with `url` → fetch `catalog.json` (5 s, 8 MB) → `parseCatalog` → `upsertFromCatalog` each; response shows counts. Bearer header `Authorization: Bearer <token>` also accepted on admin routes.

- [ ] Tests: 404 without token config; wrong token → 401; approve flips status; import from fake fetch upserts 2 bots.
- [ ] Commit `feat(web): admin queue and catalog import`.

### Task 12: Server, CLI, seed data

**Files:**
- Create: `src/server.ts` (`startServer(config): Promise<{ close(): Promise<void>; port: number }>`), `src/index.ts` (CLI: `serve` default; `import <url>`; `export [file]`; `validate <recipe.json>`; `--help`), `seed/catalog.json` (6 example bots: 4 template-based using real public x.ai ids from the marketplace with their public name/description, 2 recipe-based authored for this project), `src/db/seed.ts` (`seedIfEmpty(repo, catalogPath)`) called when `BOTMARKET_SEED=true` or on first boot with empty DB and `BOTMARKET_SEED!=='false'`.
- Test: `tests/cli.test.ts` (validate command exit codes using `node --import tsx` or built dist).

- [ ] Commit `feat: server entry, cli, seed catalog`.

### Task 13: Docker, CI, README

**Files:**
- Create: `Dockerfile` (multi-stage node:22-alpine, `npm ci`, build, prune dev, non-root, `VOLUME /data`, `ENV BOTMARKET_DATA_DIR=/data`, `EXPOSE 3000`, `HEALTHCHECK` on `/healthz`), `docker-compose.yml`, `.dockerignore`, `.github/workflows/ci.yml` (node 22: `npm ci`, `typecheck`, `test`, `build`, `docker build`), `README.md` (what it is, screenshot placeholder, one-click install explanation incl. the deep link, quick start npx/docker, publishing a bot, recipe format, API, env vars, federation, how it was verified against Grok Bot 0.78.1, disclaimer: not affiliated with xAI/Cursor), `CONTRIBUTING.md`, `docs/recipe-format.md`, `docs/api.md`.

- [ ] Verify `docker build .` succeeds locally if Docker is available; commit `chore: docker, ci, docs`.

### Task 14: End-to-end verification

- [ ] `npm run build && node dist/index.js serve` on a free port; `curl /healthz`, `/`, `/bots/<seed slug>`, `/add/<slug>` (expect 302 Location deep link), `/catalog.json`, `/badge/<slug>.svg`.
- [ ] On this Mac: `open "grokbot://app/v1/bot-template?id=i03IaF768-ielyzegoGye"` and confirm Grok Bot brings up the template review (screenshot via computer-use). Do not click "Add Bot".
- [ ] Record results in README "Verified against" section.
