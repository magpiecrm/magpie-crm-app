# AI Copilot — behavioural notes

> **This file is no longer the copilot's system prompt.**
>
> The prompt is assembled at runtime by `src/server/copilot/prompt.ts`, which
> generates the tool reference from the registry in `src/server/copilot/tools/`
> and the block reference from `BLOCK_TYPES` in
> `src/features/email-builder/types.ts`. Generating both means they cannot drift
> from the code — which is what had happened here: this file documented 16 of
> the 20 block types and shipped a ~500-line "valid industries" list that
> disagreed with the app's own `INDUSTRIES` constant.
>
> Industry values are now resolved through the `searchIndustries` tool, which
> reads the same `industries.ts` constant the prospect-search and persona UIs
> use. Prospects come from `searchCompanies` / `searchPeople` (SocialFetch).

## Where to change what

| To change… | Edit |
|---|---|
| Tone, working style, email-writing guidance | The `BEHAVIOUR` constant in `src/server/copilot/prompt.ts` |
| Which tools exist, their arguments or descriptions | `src/server/copilot/tools/*.ts` |
| Which blocks the copilot knows about | `BLOCK_TYPES` in `src/features/email-builder/types.ts` |
| Which tools require approval | `destructive` / `readOnly` flags on the tool, and `src/server/copilot/permissions.ts` |
| Valid industry values | `src/features/prospects/constants/industries.ts` |
| Valid persona location values | `src/features/prospects/constants/locations.ts` |

## Architecture

The copilot runs a long-lived provider CLI (`src/server/copilot/providers/`)
over stream-json, so the conversation lives in the agent process and tool calls
are real `tool_use` blocks rather than JSON scraped out of prose. The platform's
actions are exposed to it as an MCP server (`src/server/copilot/mcp.ts`) served
in-process at `/api/copilot/mcp`, authorised per session by a bearer token.

Turns are streamed to the browser as SSE from `/api/copilot/stream`. Tools whose
effect lives in the browser — the open email-builder design, the unsaved persona
— are marked `target: 'client'`; their mutations are queued server-side and
forwarded as `actions` events for the client to apply.
