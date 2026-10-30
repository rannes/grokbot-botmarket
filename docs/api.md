# HTTP API

All JSON responses use `Content-Type: application/json`. Replace `https://botmarket.example.com` with your host. Bot objects below show the fields most clients need; additional fields may be present.

Categories: `engineering`, `sales`, `marketing`, `design`, `personal`, `recruiting-people`, `product`, `operations`, `other`.

## Rate limits

Per client IP, in memory (reset on restart). Submissions (`POST /api/bots` and the `/submit` form): 10 per hour. Upvotes and install clicks are limited and de-duplicated per IP per day. Exceeding a limit returns `429` with a `Retry-After` header.

## `GET /api/bots`

Query parameters: `q` (text search), `category`, `sort` (`new` default, `top`, `installs`), `limit`, `offset`. Only published bots are returned.

```sh
curl 'https://botmarket.example.com/api/bots?category=engineering&sort=top&limit=2'
```

```json
{
  "bots": [
    {
      "slug": "release-notes-bot",
      "name": "Release Notes Bot",
      "tagline": "Drafts weekly release notes from merged PRs.",
      "category": "engineering",
      "tags": ["github", "releases"],
      "authorName": "Ada",
      "installClicks": 12,
      "upvotes": 4
    }
  ],
  "total": 1
}
```

Status: `200`; `400` for invalid parameters.

## `GET /api/bots/:slug`

Returns one published bot (full fields including `descriptionMd`, `templateRef`, `imageUrl`, links). Status: `200`, `404`.

## `GET /api/bots/:slug/recipe.json`

Returns the normalized `grokbot-recipe/v1` recipe. See [recipe-format.md](recipe-format.md). Status: `200`; `404` if the bot does not exist or has no recipe.

## `POST /api/bots`

Publish a bot. Body is JSON:

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | required |
| `tagline` | string | required, up to 200 characters |
| `descriptionMd` | string | Markdown, up to 20,000 characters |
| `category` | string | one of the categories above |
| `tags` | string[] | up to 10 |
| `authorName` | string | required |
| `authorUrl` | string | optional https URL |
| `imageUrl` | string | optional https URL |
| `templateRef` | string | template link or 21-character id |
| `recipeText` or `recipe` | string or object | recipe JSON as text or object |
| `sourceUrl`, `homepageUrl` | string | optional URLs |

At least one of `templateRef` and a recipe is required.

```sh
curl -X POST https://botmarket.example.com/api/bots \
  -H 'Content-Type: application/json' \
  -d '{"name":"Release Notes Bot","tagline":"Weekly notes from PRs","category":"engineering","authorName":"Ada","recipe":{"profile":{"name":"Release Notes Bot","description":"Drafts notes."}}}'
```

```json
{ "slug": "release-notes-bot", "status": "published" }
```

`status` is `pending` when the instance requires approval. Status: `201` created; `400` validation error (body describes the problem); `429` rate limited.

## `POST /api/bots/:slug/upvote`

Adds an upvote, de-duplicated per IP per day.

```json
{ "upvotes": 5 }
```

Status: `200`, `404`, `429`.

## `GET /catalog.json`

All published bots in the `botmarket-catalog/v1` format, for federation and backups.

```json
{
  "format": "botmarket-catalog/v1",
  "site": "BotMarket",
  "exportedAt": "2026-10-31T12:00:00.000Z",
  "bots": [
    {
      "slug": "release-notes-bot",
      "name": "Release Notes Bot",
      "tagline": "Drafts weekly release notes from merged PRs.",
      "descriptionMd": "…",
      "category": "engineering",
      "tags": ["github"],
      "authorName": "Ada",
      "templateRef": null,
      "recipe": { "profile": { "name": "Release Notes Bot", "description": "…" } }
    }
  ]
}
```

Status: `200`.

## `GET /add/:slug`

Counts an install click and responds `302` to the bot's deep link: `grokbot://app/v1/bot-template?id=<id>` for template bots, or `grokbot://app/v1/prompt?text=...` for recipe bots. With `?via=web`, redirects to `https://x.ai/bot/<id>`. Status: `302`, `404`, `429`.

## `GET /badge/:slug.svg`

An "Add to Grok Bot" SVG badge for READMEs. Status: `200` (`image/svg+xml`), `404`.

```md
[![Add to Grok Bot](https://YOUR-HOST/badge/SLUG.svg)](https://YOUR-HOST/add/SLUG)
```

## `GET /healthz`

Liveness check used by the Docker healthcheck. Status: `200`.

## Admin

Enabled only when `BOTMARKET_ADMIN_TOKEN` is set. Authenticate with `Authorization: Bearer <token>`, or log in at `/admin` (sets a signed cookie). From `/admin` you can approve pending bots, feature or unfeature, delete, and import another BotMarket's `catalog.json`. Wrong or missing token: `401`; admin disabled: `404`.
