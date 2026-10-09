.# CLAUDE.md

Guidance for working in this repo. See `README.md` for setup/run instructions.

## What this is

A TanStack Start app for B2B prospecting + email marketing. Contacts, lists,
and campaigns are self-hosted: a local JSON DB (`src/server/db.ts`) plus SMTP
sending via `nodemailer.ts` — there is no third-party ESP. **SocialFetch** is
the only source of company/people data for prospect search. A copilot runs
an in-process agent loop over the Anthropic or OpenAI API (the user's own
key), with the app's actions as tools.

## Architecture

- **Server layer** (`src/server/`):
  - `prospecting/` — prospect search and email finding. `socialfetch.ts` is
    the only data connector, behind the `CompanySource`/`PeopleSource`
    interfaces in `types.ts`; it maps responses down to the few allowed fields
    (name, title, seniority, company, domain, country, profile URL) and nothing
    else. `emailFinder.ts` + `patterns.ts` generate and verify addresses via the
    self-hosted verification server (`reacher.ts`), through `proxyRouter.ts`, which holds
    the per-IP and per-company rate limits and pauses listed IPs.
    `reveal.ts` finds one
    email without saving (logged to the disclosure log like a save). `save.ts`
    is the only place contacts get created from search results; `suppression.ts` holds the
    HMAC-hashed opt-out list. Search results are never persisted, and only
    non-personal data (companies, domains, patterns, catch-all) is cached
    globally — keep it that way. The two exceptions, both in server memory
    only (size-capped, never on disk): `profileCache.ts` holds profile
    lookups for 24h so a person isn't paid for twice, and `searchPool.ts`
    holds the search hits a page didn't use for 1h, so the next page or
    top-up doesn't pay for another request. One thing does leave a copy:
    `sharedPeople.ts`, in a hosted copy whose owner agreed to its host's
    Contributor Terms (Settings → Prospect search), sends the host each
    contact saved from search with a verified email, for the host's shared
    database. The host is that database's controller and sends the people in
    it their notice; nothing imported, guessed or signed-up is ever sent, and
    a copy that isn't hosted or hasn't joined sends nothing. API keys and base URLs come from
    `src/server/env.ts`; do not read `process.env` directly in new server code.
  - `usage.ts` — monthly usage counts (searches, prospects, email lookups,
    emails found, contacts saved, emails sent), shown on Settings → Overview
    and served by `GET /api/usage` when `USAGE_API_TOKEN` is set. Counts
    only; record new billable actions here. `allowance.ts` holds optional
    monthly limits a host sets through `/api/usage/allowance` (prospects,
    reveals, emails sent); check one with `requireAllowance` before an action
    that uses it. Unset means no limits.
  - `db.ts` — the app's own data store: a JSON file (`local_db.json`, path
    from `DATABASE_PATH`) holding contacts/lists/campaigns/personas/auth. In
    production this file lives on a mounted volume.
  - `emailService.ts` / `nodemailer.ts` — campaign send pipeline: reads from
    `db.ts` and sends through the configured provider (`providers/`).
  - `sendingLimits.ts` / `sendingReputation.ts` — only where the host's mail
    server sends (`SENDING_MANAGED`): daily limits for cold email (contacts
    found by prospecting who haven't signed up or replied) and opt-in email,
    which step up each week the email is received well. Reputation is judged
    from the workspace's own counts (bounces, complaints, real opens by mail
    provider). A campaign over today's limit goes back on the schedule for
    the next day (`daily_pacing`); sequences wait. A host can set either
    limit itself through `prospecting/hostRules.ts`.
  - `functions/` — `createServerFn` endpoints split by domain (`prospects`,
    `contacts`, `lists`, `campaigns`, `copilot`, and others). They are
    re-exported from `functions/index.ts`. Add new endpoints to the matching
    domain file, not a single mega-file. Callers import from
    `'.../server/functions'`.
  - `copilot/` — the copilot's own subsystem, separate from `functions/`:
    `agent.ts` runs the tool loop in-process, calling the model API through
    an adapter in `providers/` (`anthropic.ts`, `openai.ts`); `tools/*` are
    the app's actions, run through `executeTool` in `mcp.ts` (validation,
    approval gate, error text); `state.ts` tracks sessions and their event
    bus; `permissions.ts` decides which tool calls need the user's approval.
    The SSE turn endpoint is `src/routes/api/copilot/stream.ts`.
    `settings.ts` holds the user's own Anthropic and OpenAI API keys (never a
    Claude.ai or ChatGPT login — Anthropic's terms don't allow apps to offer
    or share one). `src/routes/api/mcp.ts` exposes the same tools to outside
    AI apps (`PUBLIC_TOOLS` in `mcp.ts`: server-side tools not marked
    `browserOnly`), authorised by MCP-scoped API keys.
- **Query keys** live in `src/queryKeys.ts`. Use the `queryKeys` factory for
  every `useQuery`/`invalidateQueries` call instead of inline arrays, so
  invalidation stays consistent.
- **Features** (`src/features/*`) are self-contained (components + types +
  utils/constants). The email builder is the largest: block model in
  `email-builder/types.ts`, rendered by `BlockRenderer`, compiled to HTML by
  `utils/compiler.ts`.
- **UI primitives** live in `src/components/ui/` (Button, Dialog, Badge, etc.);
  reuse these rather than hand-rolling. Form fields use `Field`, `FieldGrid`
  and `INPUT_CLASS` (`Field.tsx`); messages use `Notice`.
- **Settings pages** all share one layout (`features/settings/components/
  SettingsBlock.tsx`): one `SettingsPanel` per page, divided into
  `SettingsBlock`s whose controls share a fixed column, lists as
  `SettingsRow`s, and a block's buttons bottom-left in `SettingsActions`.
  Build new settings from these, in sentence case, rather than new cards.

## Conventions

- Production runs `serve.ts` (Bun) over the Vite build, not `vite preview`,
  which uses about twice the memory. `bun run build && bun run start`.

- TypeScript is `strict` with `noUnusedLocals`/`noUnusedParameters` — unused
  symbols fail typecheck. Verify changes with `bunx tsc --noEmit`.
- Imports are relative today. The `#/*` -> `./src/*` alias is wired in
  `package.json`/`tsconfig.json` if you want to use it.
- `scratch/` is gitignored throwaway space; don't import from it.

## Known rough edges (improve opportunistically)

- Several large components (`ProspectSearch`, `AIChat`, `CampaignWizard`,
  `campaigns/$id.tsx`) mix data-fetching, mutations, and big JSX — extract hooks
  / subcomponents when you touch them.
- Many `createServerFn` input validators are typed `any`; tighten when editing.
- Domain types (e.g. `Contact`) are defined inside components rather than a
  shared `types.ts`.
