.# CLAUDE.md

Guidance for working in this repo. See `README.md` for setup/run instructions.

## What this is

A TanStack Start app for B2B prospecting + email marketing. Contacts, lists,
and campaigns are self-hosted: a local JSON DB (`src/server/db.ts`) plus SMTP
sending via `nodemailer.ts` — there is no third-party ESP. **SocialFetch** is
the only source of company/people data for prospect search. A copilot feature shells out to a local
`claude` CLI, driving it as a long-lived MCP-tool agent rather than one-shot
prompts.

## Architecture

- **Server layer** (`src/server/`):
  - `prospecting/` — prospect search and email finding. `socialfetch.ts` is
    the only data connector, behind the `CompanySource`/`PeopleSource`
    interfaces in `types.ts`; it maps responses down to the few allowed fields
    (name, title, seniority, company, domain, country, profile URL) and nothing
    else. `emailFinder.ts` + `patterns.ts` generate and verify addresses via the
    verifier chosen in settings: `reacher.ts` (through `proxyRouter.ts`) or
    `neverbounce.ts`. `reveal.ts` finds one
    email without saving (logged to the disclosure log like a save). `save.ts`
    is the only place contacts get created from search results; `suppression.ts` holds the
    HMAC-hashed opt-out list. Search results are never persisted, and only
    non-personal data (companies, domains, patterns, catch-all) is cached
    globally — keep it that way. API keys and base URLs come from
    `src/server/env.ts`; do not read `process.env` directly in new server code.
  - `db.ts` — the app's own data store: a JSON file (`local_db.json`, path
    from `DATABASE_PATH`) holding contacts/lists/campaigns/personas/auth. In
    production this file lives on a mounted volume.
  - `emailService.ts` / `nodemailer.ts` — campaign send pipeline: reads from
    `db.ts`, sends over SMTP. This replaced a prior Brevo integration; some
    comments/UI copy still reference Brevo's data shapes for parity and can be
    cleaned up opportunistically.
  - `functions/` — `createServerFn` endpoints split by domain (`prospects`,
    `contacts`, `lists`, `campaigns`, `copilot`, and others). They are
    re-exported from `functions/index.ts`. Add new endpoints to the matching
    domain file, not a single mega-file. Callers import from
    `'.../server/functions'`.
  - `copilot/` — the copilot's own subsystem, separate from `functions/`:
    `session.ts` spawns the `claude` CLI as a long-lived subprocess per chat
    session; `mcp.ts` + `tools/*` expose the app's actions to it as MCP tools
    over a local HTTP endpoint (`src/routes/api/copilot/mcp.ts`); `state.ts`
    tracks sessions and per-session bearer tokens; `permissions.ts` gates
    mutating tool calls independently of the CLI's own (bypassed) permission
    prompt. The SSE turn endpoint is `src/routes/api/copilot/stream.ts`.
- **Query keys** live in `src/queryKeys.ts`. Use the `queryKeys` factory for
  every `useQuery`/`invalidateQueries` call instead of inline arrays, so
  invalidation stays consistent.
- **Features** (`src/features/*`) are self-contained (components + types +
  utils/constants). The email builder is the largest: block model in
  `email-builder/types.ts`, rendered by `BlockRenderer`, compiled to HTML by
  `utils/compiler.ts`.
- **UI primitives** live in `src/components/ui/` (Button, Dialog, Badge, etc.);
  reuse these rather than hand-rolling.

## Conventions

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
