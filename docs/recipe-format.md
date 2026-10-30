# Recipe format: `grokbot-recipe/v1`

A recipe describes a bot's profile, memories, skills, routines and plugins as plain JSON. It has the same shape Grok Bot uses when it hands a new bot its setup context from a template, so a bot's own export can be pasted unchanged.

## Example

```json
{
  "format": "grokbot-recipe/v1",
  "profile": { "name": "Release Notes Bot", "description": "Drafts weekly release notes from merged PRs.", "avatarShape": "capsule", "avatarColor": "blue" },
  "memory":   [ { "content": "Our release cadence is weekly on Thursdays.", "kind": "profile" } ],
  "skills":   [ { "name": "draft-release-notes", "description": "Turns merged PRs into notes.", "content": "# Steps\n1. List merged PRs.\n2. Group by area." } ],
  "routines": [ { "name": "Weekly notes", "description": "Thursday draft", "content": "Draft notes from PRs merged this week.", "schedule": "0 9 * * 4", "timezone": "Europe/Tallinn", "enabled": false } ],
  "plugins":  [ { "pluginId": "32661537", "name": "GitHub", "description": "Reads merged PRs" } ],
  "gettingStarted": { "skill": "draft-release-notes" },
  "setupNotes": "Needs read access to the repo."
}
```

## Fields

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `format` | string | no | `"grokbot-recipe/v1"` (or `"grokbot-bundle/v1"`, converted). Any other value is rejected. Output is always `grokbot-recipe/v1`. |
| `profile` | object | yes (or `persona` for bundles) | See below. If `profile` is absent and `persona` is present, the input is treated as a `grokbot-bundle/v1`. |
| `memory` | array | no, default `[]` | Memory entries. |
| `skills` | array | no, default `[]` | Skill definitions. |
| `routines` | array | no, default `[]` | Scheduled or triggered prompts. |
| `plugins` | array | no, default `[]` | Plugins the bot expects. |
| `gettingStarted` | object | no | `{ "skill": "<skill name>" }` (skill up to 200 characters): the skill to run first. A bare string is accepted and read as the skill name. |
| `setupNotes` | string | no | Free text for whoever installs the recipe, up to 20,000 characters. |

### `profile`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | Up to 200 characters. |
| `description` | string | no | Up to 20,000 characters. Defaults to an empty string. |
| `avatarShape` | string | no | Up to 100 characters. For example `pebble`, `capsule`, `teardrop`. |
| `avatarColor` | string | no | Up to 100 characters. A color name such as `magenta` or `blue`. |

### `memory[]`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `content` | string | yes | 1-20,000 characters. Written as a journal memory on install. |
| `kind` | string | no | Either `profile` or `log`. |
| `createdAt` | string | no | Any string up to 100 characters (normally ISO 8601). |

### `skills[]`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | 1-200 characters. |
| `description` | string | no | Up to 20,000 characters. |
| `content` | string | yes | 1-200,000 characters, usually Markdown. |

### `routines[]`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | 1-200 characters. |
| `description` | string | no | Up to 20,000 characters. |
| `content` | string | yes | The prompt the routine runs, 1-200,000 characters. |
| `schedule` | string | no | Up to 200 characters, normally a cron expression. |
| `timezone` | string | no | Up to 100 characters, IANA zone such as `Europe/Tallinn`. |
| `enabled` | boolean | no | Informational. Routines are always created paused on install. |

### `plugins[]`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `pluginId` | string | no | Up to 200 characters. The Grok Bot marketplace plugin id (digits). |
| `name` | string | yes | 1-200 characters. |
| `description` | string | no | Up to 20,000 characters. Why the bot wants it. |

Plugins are installed only after the user confirms.

## Accepted aliases

On input, these are normalized to the canonical shape:

- Skill `body` is read as `content`.
- Routine `prompt` is read as `content`.
- `memory` may be a bare string, or an array of strings; each becomes `{ "content": ... }`.

`/api/bots/:slug/recipe.json` always serves the normalized recipe.

## `grokbot-bundle/v1` conversion

The community bundle format is converted on import:

| Bundle | Recipe |
| --- | --- |
| `persona` (`name`, `description`, `avatarShape`, `avatarColor`) | `profile` |
| `memories[].text` | `memory[].content` |
| `memories[].kind` | `memory[].kind` |
| `skills[].body` (or `content`) | `skills[].content` |
| `routines[].prompt` (or `content`) | `routines[].content` |
| `routines[].triggerSummary` | `routines[].description` |
| `routines[].schedule` | `routines[].schedule` |
| `plugins[].id` | `plugins[].pluginId` |
| `plugins[].name` (falls back to `id`) | `plugins[].name` |
| `plugins[].note` | `plugins[].description` |

## Limits

| Item | Limit |
| --- | --- |
| Profile name | 200 characters |
| Profile description | 20,000 characters |
| Memories | 200 |
| Skills | 64 |
| Routines | 100 |
| Plugins | 40 |
| Recipe JSON (pasted text, JSON API `recipe` object, CLI) | 2 MB |
| Whole request body (form or JSON API) | 6 MB |
| Skill and routine content | 200,000 characters each |

Whitespace-only optional strings are dropped. Nesting deeper than 64 levels is rejected. Objects containing the keys `__proto__`, `constructor` or `prototype` are rejected. Validate locally with `grokbot-botmarket validate recipe.json`.

## What is never included

Recipes carry no secrets or API keys, no logins, no conversation history, no personal memories you did not choose to export, and no custom MCP server configs or scripts. Do not put credentials in memory, skill or routine text; recipes are public.

## Producing a recipe from a bot

Ask your bot: "Export your template as JSON with profile, memory, skills, routines and plugins." Remove anything private, then paste the result at `/submit`. The bot's output is accepted as is, aliases included.

## How a recipe is installed

The "Create in Grok Bot" button opens `grokbot://app/v1/prompt?text=...` with a setup prompt (at most 1000 characters). The prompt tells a new bot to fetch the recipe from `/api/bots/<slug>/recipe.json`, review it with you, then set itself up: memories as journal memories, skills as skills, routines created paused, plugins only after asking. Nothing happens until you send the prompt in Grok Bot.
