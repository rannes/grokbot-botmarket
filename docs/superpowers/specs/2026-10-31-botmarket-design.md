# BotMarket: a self-hosted marketplace for Grok Bot bots

Date: 2026-10-31. Status: approved for build (user asked for autonomous execution; design calls below are the builder's).

## Intent

Grok Bot (xAI's desktop agent app, built on Cursor infrastructure, bundle id `com.anysphere.sand`) lets a person run "bots": durable AI teammates with a name, instructions/memories, skills, routines (automations) and plugins (connectors). xAI runs one official marketplace at `https://x.ai/bot/marketplace`. There is no way for a team, community or company to run their *own* catalog of shareable bots.

BotMarket is that: a self-hosted web app where people publish bots with a description of what they do, and anyone can add a bot to their own Grok Bot with a single click.

## What we verified about Grok Bot (v0.78.1, from the app bundle and docs)

These facts drive the design and must stay true in the code:

- **Template share pages** are `https://x.ai/bot/<id>` where `<id>` matches `/^[A-Za-z0-9_-]{21}$/` (nanoid). The page's "Add to Grok Bot" button is the deep link `grokbot://app/v1/bot-template?id=<id>`.
- **Deep-link router** (app code): schemes `grokbot:` and `sand:`, authority `app`; https universal-link equivalents `https://cursor.com/grok-bot/link/v1/...` and `https://cursor.com/sand/link/v1/...`. Routes we use:
  - `/v1/bot-template?id=<21-char id>[&open=1]` opens the template import review in the app.
  - `/v1/prompt?text=<non-empty, ≤1000 chars decoded>[&id=<agent id>]` opens a chat with that text pre-filled (optionally for a given bot).
  - `/v1/marketplace[?tab=plugins|bots][&id=<slug>]`, `/v1/plugin/add?id=<digits>`, `/v1/agent?id=`, `/v1/settings?id=`, `/v1/open`.
  - The parser accepts a bare 21-char id as a template reference too. Max URL length 2048. No username/password/port/hash allowed.
- **Template "recipe"**: when a bot is created from a template, the app hands the new bot a JSON setup context with exactly this shape, then instructs the bot to recreate everything itself:

  ```json
  {
    "routines": [ ... automations: name, description, content, trigger ... ],
    "plugins":  [ { "plugin_id": "...", "name": "...", "description": "..." } ],
    "memories": [ { "content": "...", "created_at": "..." } ],
    "skills":   [ { "name": "...", "description": "...", "content": "..." } ]
  }
  ```
  Routines are created paused; plugins are installed only after the user confirms; memories are written as journal memories; skills are written as skills. A template may name a `gettingStartedSkill`.
- **Template profile** fields: `name` (≤255), `avatar_shape`, `avatar_color`, `body` (≤4000, the description), optional `visibility` (`public`|`team`).
- **Not transferable** via templates: secrets, logins, conversation history, custom MCP servers / scripts, personal memories, the cloud computer.
- The public x.ai page exposes only title, description and an OpenGraph image (`og:image`). Skills/plugins are visible only inside the app's import review.
- **Public metadata API (verified live, no auth):** `POST https://api2.cursor.sh/aiserver.v1.GrokBotService/GetPublicGrokBotTemplate` with headers `Content-Type: application/json`, `Connect-Protocol-Version: 1` and body `{"shareId":"<id>"}` returns `{"template":{"shareId","name","description","avatarShape","avatarColor","published","activeVersion",...}}`. Fallback: the x.ai page's `og:title` / `og:description` / `og:image` meta tags. Known avatar shapes include `pebble`, `capsule`, `teardrop`; colors are names like `magenta`.
- **Recipe shape Grok Bot itself emits** (what a bot writes when asked to export its template, and what import tools consume): `{"profile":{"name","description","avatarShape?","avatarColor?"},"memory":[{"content","kind?","createdAt?"}],"skills":[{"name","description?","content"}],"routines":[{"name","description?","content","schedule?","timezone?","enabled?"}],"plugins":[{"pluginId?","name","description?"}],"gettingStarted?":{"skill"}}`. The community `grokbot-bundle/v1` format (pi-grokbot-import) uses `persona`/`memories[].text`/`skills[].body`/`routines[].prompt`/`plugins[].id`.
- Sharing requires the author's team policy to allow it (`exportPolicy`: `all` | `team_only` | `none`).

## Goals

1. **One-click add.** Every listing has an "Add to Grok Bot" button that opens the app directly via `grokbot://app/v1/bot-template?id=…`, with the x.ai page as a no-app fallback.
2. **Shareable listings.** Each bot has a stable URL with OpenGraph tags so it unfurls in Slack/X/iMessage, plus a README badge.
3. **Easy publishing.** Paste a template link (any accepted form) and the server pre-fills name, description and image from x.ai. Add tags, a category, a longer "what it does", and publish.
4. **Open recipes.** Bots can also be published as an open `grokbot-recipe/v1` JSON (same shape the app uses) when the author has no official template or wants the contents public. Those install via the `prompt` deep link: the new bot is told to fetch the recipe URL and set itself up, mirroring the app's own template bootstrap.
5. **Self-hosted in one command.** `npx grokbot-botmarket` or `docker run`. SQLite file, no external services.
6. **Federation-friendly.** `GET /catalog.json` exports everything; an admin can import another BotMarket's catalog.

## Non-goals

- Replacing or scraping xAI's marketplace. We link to x.ai, we never proxy it.
- Hosting secrets, API keys, or plugin binaries.
- User accounts / OAuth in v1. Submissions are open (optionally held for admin approval); moderation is a single admin token.
- Mobile apps.

## Anti-goals (would make it a failure)

- A listing whose "Add" button does nothing on a machine with Grok Bot installed.
- Letting a listing inject arbitrary HTML/JS (descriptions are Markdown rendered to sanitized HTML).
- Requiring a build step or native compilation to self-host.

## How it gets made (builder's calls)

- **Runtime:** Node.js ≥ 22.13 (needed for unflagged `node:sqlite`). TypeScript, ESM.
- **HTTP + SSR:** Hono with its JSX renderer. Server-rendered HTML, progressive enhancement with small vanilla JS; no frontend bundler.
- **Storage:** `node:sqlite` (zero native deps). Schema migrations run at boot.
- **Validation:** Zod for request bodies, recipe JSON and catalog import.
- **Markdown:** `marked` + `sanitize-html` (or equivalent) for descriptions.
- **Tests:** Vitest; unit tests for link parsing, recipe validation, install-link building, catalog round-trip; integration tests against the Hono app with an in-memory DB.
- **Packaging:** npm package `grokbot-botmarket` with a `bin`; Dockerfile (node:22-alpine, non-root, volume at `/data`); `docker-compose.yml`; GitHub Actions CI (typecheck, test, docker build).
- **Config via env:** `PORT` (3000), `BOTMARKET_DATA_DIR` (`./data`), `BOTMARKET_ADMIN_TOKEN` (optional; enables admin UI), `BOTMARKET_REQUIRE_APPROVAL` (`false`), `BOTMARKET_SITE_NAME`, `BOTMARKET_PUBLIC_URL` (for absolute OG/recipe URLs).

## Data model

`bots`
- `slug` (pk, kebab-case, unique), `name`, `tagline` (≤200), `description_md` (≤20k), `category` (enum: engineering, sales, marketing, design, personal, recruiting-people, product, operations, other), `tags` (json array ≤10)
- `author_name`, `author_url` (optional)
- `avatar_shape`, `avatar_color` (optional, mirror Grok Bot's), `image_url` (optional; x.ai og:image or user-supplied https URL)
- `template_id` (21-char id, nullable) — the official Grok Bot template
- `recipe_json` (nullable, validated `grokbot-recipe/v1`)
- `source_url`, `homepage_url` (optional)
- `status` (`published` | `pending`), `featured` (bool)
- `install_clicks`, `upvotes` (ints), `created_at`, `updated_at`
- Constraint: at least one of `template_id` / `recipe_json`.

`events` (install clicks and upvotes, for de-dup by hashed IP+day). `settings` (key/value, e.g., imported-from).

## Recipe format `grokbot-recipe/v1`

Same shape Grok Bot emits, so a bot's own export uploads unchanged:

```json
{
  "format": "grokbot-recipe/v1",
  "profile": { "name": "Release Notes Bot", "description": "Drafts weekly release notes from merged PRs.", "avatarShape": "capsule", "avatarColor": "blue" },
  "memory":   [ { "content": "Our release cadence is weekly on Thursdays.", "kind": "profile" } ],
  "skills":   [ { "name": "draft-release-notes", "description": "…", "content": "# Steps\n…" } ],
  "routines": [ { "name": "Weekly notes", "description": "…", "content": "Draft notes from PRs merged this week.", "schedule": "0 9 * * 4", "timezone": "Europe/Tallinn", "enabled": false } ],
  "plugins":  [ { "pluginId": "32661537", "name": "GitHub", "description": "Reads merged PRs" } ],
  "gettingStarted": { "skill": "draft-release-notes" },
  "setupNotes": "Needs read access to the repo."
}
```
Rules: `format` optional (detected by `profile`); `memory`, `skills`, `routines`, `plugins` default to `[]`; aliases accepted on input: skill `body`→`content`, routine `prompt`→`content`, memory as a bare string or array of strings; `grokbot-bundle/v1` is converted (`persona`→`profile`, `memories[].text`→`content`, `routines[].prompt`→`content`, `plugins[].id`→`pluginId`). Limits: profile name ≤200, description ≤20 000, ≤200 memories, ≤64 skills, ≤100 routines, ≤40 plugins, ≤2 MB; keys `__proto__`/`constructor`/`prototype` rejected. `/api/bots/:slug/recipe.json` serves the normalized recipe.

## Install flows

1. **Template listing** → primary button `grokbot://app/v1/bot-template?id=<id>`; secondary "Open on x.ai" `https://x.ai/bot/<id>`; also show the universal link `https://cursor.com/grok-bot/link/v1/bot-template?id=<id>` under "Other ways to add". `/add/<slug>` counts the click then redirects to the deep link (used by the badge and by shared links).
2. **Recipe listing** → primary button "Create in Grok Bot" = `grokbot://app/v1/prompt?text=<setup prompt>` where the prompt (≤1000 chars) tells a new bot to fetch `<PUBLIC_URL>/api/bots/<slug>/recipe.json`, review it with the user, and set itself up (memories → journal memories, skills → skills, routines → paused routines, plugins → ask before installing). Secondary: "Copy setup prompt", "Download recipe JSON".
3. No app installed → the x.ai page / download link.

## Pages

- `/` — hero + search, category chips, featured row, grid of bot cards (name, tagline, author, category, "Add" button).
- `/bots/:slug` — detail: avatar/image, name, tagline, author, tags, Add buttons, rendered description, recipe contents (memories/skills/routines/plugins as readable sections), "share" (copy link, badge markdown), install count, upvote.
- `/submit` — step 1: paste link or upload/paste recipe JSON → preview; step 2: edit fields → publish.
- `/c/:category`, `/search?q=` — filtered lists.
- `/admin` (token) — pending queue, feature/unfeature, delete, import catalog.
- `/api/*`, `/catalog.json`, `/badge/:slug.svg`, `/add/:slug`, `/healthz`.

## Security

- Deep links are built only from validated ids (regex) and URL-encoded text; never from raw user strings.
- Markdown sanitized; only `https:` image URLs; CSP header; no inline event handlers.
- Rate limit submissions and clicks per IP (in-memory token bucket).
- Admin routes require `Authorization: Bearer <token>` or a signed cookie set by `/admin/login`.
- x.ai metadata fetch: server-side, only to `https://x.ai/bot/<validated id>`, 5s timeout, ≤512 KB, parse only `<meta>` tags.

## Left to the builder

Exact visual design (follow the frontend-design skill: distinctive, not template-y; dark/light via `prefers-color-scheme`), copy, icon set, test fixtures, and the Dockerfile details.
