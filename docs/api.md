# HTTP API

Responses are JSON unless noted. Replace `https://botmarket.example.com` with your host. Only published bots are visible through the API; pending bots return `404`.

Categories: `engineering`, `sales`, `marketing`, `design`, `personal`, `recruiting-people`, `product`, `operations`, `other`.

## Bot object

Every bot in the API (and in the catalog) has this shape:

```json
{
  "slug": "release-notes-bot",
  "name": "Release Notes Bot",
  "tagline": "Drafts weekly release notes from merged PRs.",
  "descriptionMd": "Markdown text",
  "category": "engineering",
  "tags": ["github", "releases"],
  "authorName": "Ada",
  "authorUrl": "https://example.com/ada",
  "avatarShape": "capsule",
  "avatarColor": "blue",
  "imageUrl": null,
  "templateId": null,
  "recipe": { "format": "grokbot-recipe/v1", "profile": { "name": "Release Notes Bot", "description": "…" }, "memory": [], "skills": [], "routines": [], "plugins": [] },
  "sourceUrl": null,
  "homepageUrl": null,
  "createdAt": "2026-10-31T12:00:00.000Z",
  "updatedAt": "2026-10-31T12:00:00.000Z",
  "installUrl": null,
  "pageUrl": null
}
```

For template bots, `templateId` is the 21-character id, `installUrl` is `grokbot://app/v1/bot-template?id=<id>` and `pageUrl` is `https://x.ai/bot/<id>`; for recipe bots `installUrl` and `pageUrl` are `null` (use `/add/<slug>`). A bot can have both a template and a recipe. Install counts and upvote counts are shown on the website but are not part of API objects.

## Rate limits

Only submissions and admin logins are rate limited: `POST /api/bots` and `POST /submit` share a limit of 10 per hour per client IP, `POST /submit/lookup` is limited to 30 per 10 minutes per IP, and `POST /admin/login` to 10 attempts per 15 minutes per IP. Over the limit, the API returns `429` with `{"error":"rate limited"}` (the HTML form re-renders with a 429 and keeps the user's values). Limits are in memory and reset on restart. Upvotes and install clicks are not rate limited; they are de-duplicated per IP per day.

The client IP is the socket address. When `BOTMARKET_TRUST_PROXY=true` (set this behind a reverse proxy that appends to `X-Forwarded-For`) the last `X-Forwarded-For` hop is used instead. Request bodies over 6 MB get `413` with `{"error":"payload too large"}`.

## `GET /api/bots`

| Param | Notes |
| --- | --- |
| `q` | Text search. |
| `category` | One of the categories above. |
| `sort` | `new` (default), `top`, `installs`. |
| `limit` | Default 50, maximum 100. |
| `offset` | Default 0. |

An invalid `category`, `sort`, `limit` or `offset` returns `400` with `{"error":"..."}`.

```sh
curl 'https://botmarket.example.com/api/bots?category=engineering&sort=top&limit=2'
```

```json
{ "bots": [ { "slug": "release-notes-bot", "name": "Release Notes Bot", "…": "…" } ], "total": 1 }
```

`total` counts all matches ignoring `limit` and `offset`.

## `GET /api/bots/:slug`

Returns one bot object. `404` with `{"error":"not found"}` if missing or pending.

## `GET /api/bots/:slug/recipe.json`

Returns the normalized `grokbot-recipe/v1` recipe with `Content-Disposition: inline; filename="<slug>.recipe.json"`. `404` if the bot is missing, pending, or has no recipe. See [recipe-format.md](recipe-format.md).

## `POST /api/bots`

Publish a bot. Send JSON (`Content-Type: application/json`).

| Field | Type | Rules |
| --- | --- | --- |
| `name` | string | required, 1-80 characters |
| `tagline` | string | required, 1-200 characters |
| `descriptionMd` | string | Markdown, up to 20,000 characters, default empty |
| `category` | string | required, one of the categories above |
| `tags` | string[] or comma-separated string | lowercased, de-duplicated, at most 10, each at most 32 characters |
| `authorName` | string | required, 1-80 characters |
| `authorUrl`, `imageUrl`, `sourceUrl`, `homepageUrl` | string | optional, `https:` URLs only, up to 2048 characters |
| `avatarShape`, `avatarColor` | string | optional, up to 32 characters; default from the recipe profile |
| `templateRef` | string | template link (`https://x.ai/bot/<id>`, `grokbot://` link, cursor.com link) or bare 21-character id |
| `recipeText` | string | recipe JSON as text (up to 2 MB) |
| `recipe` | object | recipe as a JSON object; `recipeText` wins if both are set |

At least one of `templateRef` and a recipe is required.

```sh
curl -i -X POST https://botmarket.example.com/api/bots \
  -H 'Content-Type: application/json' \
  -d '{"name":"Release Notes Bot","tagline":"Weekly notes from PRs","category":"engineering","authorName":"Ada","recipe":{"profile":{"name":"Release Notes Bot"}}}'
```

Response `201` with header `Location: /bots/release-notes-bot` and the full bot object plus `status`:

```json
{ "slug": "release-notes-bot", "name": "Release Notes Bot", "…": "…", "status": "published" }
```

`status` is `pending` when the instance sets `BOTMARKET_REQUIRE_APPROVAL=true`; the bot is then hidden until an admin approves it. Errors:

- `400` with `{"errors": ["name: is required", "recipe: profile: is required"]}`; also returned when the body is not valid JSON.
- `429` with `{"error":"rate limited"}`.

The slug is generated from the name.

## `POST /api/bots/:slug/upvote`

No body. Counts one upvote per IP per day.

```json
{ "upvotes": 5, "counted": true }
```

A repeat upvote the same day returns `200` with `counted: false` and the unchanged total. `404` if the bot is missing or pending.

## `GET /catalog.json`

All published bots in `botmarket-catalog/v1` format, cached for 5 minutes (`Cache-Control: public, max-age=300`). Used for federation and backups.

```json
{
  "format": "botmarket-catalog/v1",
  "generatedAt": "2026-10-31T12:00:00.000Z",
  "site": { "name": "BotMarket", "url": "https://botmarket.example.com" },
  "bots": [ { "slug": "release-notes-bot", "…": "bot object as above" } ]
}
```

`site.url` is `null` if the origin is unknown; on import it may be `http:` or `https:` (it is informational), while bot URLs must be `https:`. Timestamps are strings of at most 64 characters. On import, `format`, `generatedAt`, `site.name` and each bot's `slug`, `name`, `tagline`, `category`, `authorName` and a template id or recipe are required; at most 5000 bots; duplicate slugs and invalid entries reject the whole file with a list of errors. `installUrl` and `pageUrl` are recomputed on import.

Importing (admin page or `grokbot-botmarket import`) upserts by slug: a bot with the same slug is overwritten with the imported content, keeping its existing status and featured flag. New bots are created as published.

## `GET /add/:slug`

Counts an install click (de-duplicated per IP per day) and redirects with `302` and `Cache-Control: no-store`:

- template bot: `grokbot://app/v1/bot-template?id=<id>`; with `?via=web`, `https://x.ai/bot/<id>`.
- recipe bot: `grokbot://app/v1/prompt?text=<setup prompt>`.

`404` if the bot is missing or pending. `/add` is never rate limited.

## `GET /badge/:slug.svg`

The "Add to Grok Bot" SVG badge (`image/svg+xml`, cached for an hour). `404` if the bot is missing or pending.

```md
[![Add to Grok Bot](https://YOUR-HOST/badge/SLUG.svg)](https://YOUR-HOST/add/SLUG)
```

## `GET /healthz`

Returns `200` with `{"ok":true}`. Used by the Docker healthcheck.

## Admin

Enabled only when `BOTMARKET_ADMIN_TOKEN` is set. Authenticate with `Authorization: Bearer <token>` or the signed cookie set by the login form. `GET /admin` shows a login page when unauthenticated, otherwise the dashboard. Admin POST routes answer `401` when unauthenticated and `403` when the CSRF (same-origin) check fails; the browser's `Origin` must match the request origin or `BOTMARKET_PUBLIC_URL`.

| Route | Purpose |
| --- | --- |
| `POST /admin/login` | Form field `token`; sets the cookie and redirects (303). Wrong token: `401`. More than 10 attempts per IP in 15 minutes: `429`. |
| `GET /admin/bots/:slug` | Bot page for any bot, pending included, with a preview banner and an Approve button for pending bots. `401` unauthenticated, `404` unknown slug. |
| `POST /admin/logout` | Clears the cookie, redirects (303). |
| `POST /admin/bots/:slug/approve` | Publish a pending bot. |
| `POST /admin/bots/:slug/feature` | Feature a bot. |
| `POST /admin/bots/:slug/unfeature` | Remove the featured flag. |
| `POST /admin/bots/:slug/delete` | Delete a bot permanently. |
| `POST /admin/import` | Field or JSON `url`: an `https:` URL of another BotMarket's `catalog.json` (5 second timeout, 8 MB cap, no redirects). Upserts as described above. |
| `GET /admin/export` | Redirects (302) to `/catalog.json`. |

Bot actions redirect (303) to `/admin`; an unknown slug or action is `404`; a failed import re-renders the dashboard with `400` and the errors.
