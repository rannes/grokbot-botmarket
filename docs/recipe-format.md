# Recipe format: `grokbot-recipe/v1`

A recipe describes a bot's profile, memories, skills, routines and plugins as plain JSON. It has the same shape Grok Bot uses when it hands a new bot its setup context from a template, so a bot's own export can be uploaded unchanged.

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
| `format` | string | no | `"grokbot-recipe/v1"`. If absent, the format is detected by the presence of `profile`. |
| `profile` | object | yes | See below. |
| `memory` | array | no, default `[]` | Memory entries. |
| `skills` | array | no, default `[]` | Skill definitions. |
| `routines` | array | no, default `[]` | Scheduled or triggered prompts. |
| `plugins` | array | no, default `[]` | Plugins the bot expects. |
| `gettingStarted` | object | no | `{ "skill": "<skill name>" }`: the skill to run first. |
| `setupNotes` | string | no | Free text for whoever installs the recipe. |

### `profile`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | Up to 200 characters. |
| `description` | string | yes | Up to 20,000 characters. |
| `avatarShape` | string | no | For example `pebble`, `capsule`, `teardrop`. |
| `avatarColor` | string | no | A color name such as `magenta` or `blue`. |

### `memory[]`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `content` | string | yes | The memory text. Written as a journal memory on install. |
| `kind` | string | no | For example `profile`. |
| `createdAt` | string | no | ISO 8601 timestamp. |

### `skills[]`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | Skill name. |
| `description` | string | no | What the skill does. |
| `content` | string | yes | Skill body, usually Markdown. |

### `routines[]`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | |
| `description` | string | no | |
| `content` | string | yes | The prompt the routine runs. |
| `schedule` | string | no | Cron expression. |
| `timezone` | string | no | IANA zone, for example `Europe/Tallinn`. |
| `enabled` | boolean | no | Informational. Routines are always created paused on install. |

### `plugins[]`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `pluginId` | string | no | The Grok Bot marketplace plugin id (digits). |
| `name` | string | yes | |
| `description` | string | no | Why the bot wants it. |

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
| `persona` | `profile` |
| `memories[].text` | `memory[].content` |
| `skills[].body` | `skills[].content` |
| `routines[].prompt` | `routines[].content` |
| `plugins[].id` | `plugins[].pluginId` |

## Limits

| Item | Limit |
| --- | --- |
| Profile name | 200 characters |
| Profile description | 20,000 characters |
| Memories | 200 |
| Skills | 64 |
| Routines | 100 |
| Plugins | 40 |
| Total size | 2 MB |

Objects containing the keys `__proto__`, `constructor` or `prototype` are rejected. Validate locally with `grokbot-botmarket validate recipe.json`.

## What is never included

Recipes carry no secrets or API keys, no logins, no conversation history, no personal memories you did not choose to export, and no custom MCP server configs or scripts. Do not put credentials in memory, skill or routine text; recipes are public.

## Producing a recipe from a bot

Ask your bot: "Export your template as JSON with profile, memory, skills, routines and plugins." Remove anything private, then upload or paste the result at `/submit`. The bot's output is accepted as is, aliases included.

## How a recipe is installed

The "Create in Grok Bot" button opens `grokbot://app/v1/prompt?text=...` with a setup prompt (at most 1000 characters). The prompt tells a new bot to fetch the recipe from `/api/bots/<slug>/recipe.json`, review it with you, then set itself up: memories as journal memories, skills as skills, routines created paused, plugins only after asking. Nothing happens until you send the prompt in Grok Bot.
