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
    else. `webSource.ts` can take over people search by job title alone
    (where a host sends `peopleSearch: 'web'`, or a copy sets
    `PEOPLE_SEARCH=web` with its own `WEB_SEARCH_API_KEY`; searches with
    company filters, or inside one company, stay on SocialFetch's, which
    knows who works where: `runtime.ts` `getSource`): it searches Google, through Decodo, for public
    LinkedIn profiles (`site:linkedin.com/in`), reads each result's name,
    title, employer and country (`linkedinResults.ts`), and retries the
    searches Decodo can't get; profile and company lookups still go through
    `socialfetch.ts` (in a hosted copy, the host's public-page reader).
    `emailFinder.ts` + `patterns.ts` generate and verify addresses via the
    self-hosted verification server (`reacher.ts`), through `proxyRouter.ts`, which holds
    the per-IP and per-company rate limits and pauses listed IPs.
    `reveal.ts` finds one
    email without saving (logged to the disclosure log like a save). `save.ts`
    is the only place contacts get created from search results; `suppression.ts` holds the
    HMAC-hashed opt-out list. Search results are never persisted, and only
    non-personal data (companies, domains, patterns, catch-all) is cached
    globally — keep it that way. The three exceptions, all in server memory
    only (size-capped, never on disk): `profileCache.ts` holds profile
    lookups for 24h so a person isn't paid for twice, `searchPool.ts`
    holds the search hits a page didn't use for 1h, so the next page or
    top-up doesn't pay for another request (who a verified search's batch
    finds in the few minutes it goes on after the time limit cut it short
    is held the same way: `verifiedPeopleSource.ts` `createCutShortBatches`), and `searchRuns.ts` holds a
    search while it runs, and for 1h if it finished with nobody there, so
    asking again joins it rather than running and charging a second one.
    A batch of tiny companies is searched once with no job title, keeping
    those a title's own request would have (`PeopleFilters.noTitle`; a host
    can turn it off).
    `search.ts` also keeps, for 1h, the keyed hashes (not the links) of
    the profiles a search has shown, so its later pages don't show or
    charge anyone twice. An employer with no LinkedIn
    company page gets its website from a web search instead
    (`companySite.ts`, through `webSearch.ts`: the copy's own
    `WEB_SEARCH_API_KEY`, or its host's): only a domain that is plainly the
    company's name is taken, or the website on a LinkedIn company page the
    search turns up under the same name, and what was found is kept by
    company name (`company_sites`). One thing does leave a copy:
    `sharedPeople.ts`, in a hosted copy the host says contributes (someone
    there agreed to its Contributor Terms in Settings → Prospect search, or
    the host has every copy contribute until that's switched off there),
    sends the host each
    contact saved from search with a verified email, for the host's shared
    database. The host is that database's controller and sends the people in
    it their notice; nothing imported, guessed or signed-up is ever sent, nor
    anyone found on their company's website (`fromWebsite`, a host's verified
    search can add these for founder-type titles at small companies, contact
    source `website`), and
    a copy that isn't hosted or isn't contributing sends nothing. Those saved
    earlier are offered later from the contact record, so only while it still
    matches the hash of what search saved (`search_hash`); nothing else that
    writes a contact needs to know about this. Where the host
    has switched searching on, any hosted copy's search also asks it which of
    the people found it already holds (by profile hash): their job and
    employer then come from the host instead of a profile lookup, and their
    email from the host on Reveal or save (`PersonResult.shared`). Intent
    signals (`signals.ts`) mark results and can filter a search: `warm`
    (`warmAccounts.ts`, the workspace's own replies, clicks, opens by two
    people, forms and proposals at a company in the last 90 days; the Warm
    filter searches inside those companies first) and `new_in_role` (the
    shown job's start, a year or month from the profile, held in memory with
    the result like its title and never saved, sent or logged), plus `hiring`
    and `funding` from one web search each per company (`webSignals.ts`
    reads them, strict about which company and how recent;
    `companySignals.ts` asks the host, or with SIGNAL_LOOKUPS=on uses the
    copy's own key, cached in `company_signals`). Badges load after the
    results show (`useCompanySignals`); the Hiring and Funding filters find
    companies first and screen each batch before searching for people. Company
    staff counts from company pages are kept over time
    (`prospect_companies.headcount_history`) for a later growth signal.
    A sequence's emails, first and follow-ups, can be written for each
    person by the AI (`sequences/personalise.ts`, run each minute by the
    scheduler, a follow-up from what they've already been sent; kept per
    step in `Enrollment.drafts`, sent without review once it passes
    `checkDraft`). Its research
    (`companyResearch.ts`) uses Claude's own web search and fetch through
    `copilot/generate.ts`, never `webSearch.ts` or live signal lookups, and
    is given only the company's name, website and country, never the
    person; what it finds is kept by company (`company_research`). API keys and base URLs come from
    `src/server/env.ts`; do not read `process.env` directly in new server code.
  - `usage.ts` — monthly usage counts (searches, prospects, email lookups,
    emails found, contacts saved, emails sent), shown on Settings → Overview
    and served by `GET /api/usage` when `USAGE_API_TOKEN` is set. Counts
    only; record new billable actions here. `prospecting/searchLog.ts`
    keeps what each people search was for and what came of it (its filters,
    the funnel counts, and how the email lookups for the people it showed
    ended, by the `searchId` each of them carries), served by `GET
    /api/usage/searches`: filters and counts only, never who was found. `allowance.ts` holds optional
    monthly limits a host sets through `/api/usage/allowance` (prospects,
    reveals, emails sent); check one with `requireAllowance` before an action
    that uses it. Unset means no limits.
  - `db.ts` — the app's own data store: a JSON file (`local_db.json`, path
    from `DATABASE_PATH`) holding contacts/lists/campaigns/personas/auth. In
    production this file lives on a mounted volume.
  - `emailService.ts` / `nodemailer.ts` — campaign send pipeline: reads from
    `db.ts` and sends through the configured provider (`providers/`).
  - `listBuilder.ts` — lists built from filters over the workspace's own
    contacts. Filters fill a normal list once and are kept on it
    (`lists.built_from`), new matches are added only when asked, and sending
    doesn't know the difference. Picking people goes through `selectForList` in
    `features/contacts/contactFilters.ts`, which refuses a filter it can't
    apply. Don't use `applyFilters` for this: it ignores such a filter, and
    returns everyone when none is left, which is right for a page view but not
    for an audience. Previews and writes share one selection, and previews
    return counts only.
  - `sendingLimits.ts` / `sendingReputation.ts` — only where the host's mail
    server sends (`SENDING_MANAGED`): daily limits for cold email (contacts
    found by prospecting who haven't signed up or replied) and opt-in email,
    which step up each week the email is received well. Reputation is judged
    from the workspace's own counts (bounces, complaints, real opens by mail
    provider). A campaign over today's limit goes back on the schedule for
    the next day (`daily_pacing`); sequences wait. A host can set either
    limit itself through `prospecting/hostRules.ts`. Where the host offers
    inbox warmup, how the warming senders stand has a say only within that:
    trouble holds the limit, and warmup going well steps up a workspace that
    sent too little to judge, never one whose own mail was received badly.
  - `inboxWarmup.ts` — inbox warmup, only where the host offers it
    (`hostRules.ts` `hostInboxWarmup`). On hosted plans it's a paid add-on
    (one sender, up to 20 warmup emails a day), bought on Settings → Plan and
    billing (`catalogue.addons`, `warmup` on the plan); the host decides who
    has it, and where it isn't on the plan `hostWarmupPurchase` gives the
    Warmup page a price to offer it at. A sender whose inbox is connected
    (Reply detection) warms in the host's pool (Mailivery), which sends
    its warmup through the host's mail server and files the warmup it
    receives away in that inbox. Switching it on sends the inbox's login to
    the host, after someone agrees to the wording in `CONSENT_POINTS`
    (recorded in `warmup_consents`); the host passes it to the pool and
    doesn't keep it. Everything else about a sender's warmup lives with the
    host (`/v1/inbox-warmup/*`); this copy only decides whether a sender can
    warm yet (ready domain, its own working inbox, SPF and DMARC). Warmup mail
    in a connected inbox with a pool's token header (`X-Mailtrace-Verify`) is
    never a reply (`mailboxes/classify.ts`); Mailivery's carries only a code
    in its signature, so it isn't told apart yet. Placement tests (the campaign preview's third
    tab) go through the host too.
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
    or share one). A hosted copy (`COPILOT_MANAGED`) uses none of those:
    `managedAi.ts` sends the same Claude requests to the host's
    `/v1/ai/messages` (with `REACHER_SECRET`), which picks the model and
    says what each call used of the plan's AI budget (the `ai` allowance,
    shown as a percentage); the model is shown as "Maggy", never by name.
    `src/routes/api/mcp.ts` exposes the same tools to outside
    AI apps (`PUBLIC_TOOLS` in `mcp.ts`: server-side tools not marked
    `browserOnly`), authorised by MCP-scoped API keys.
- **Custom contact fields**: definitions in `db.ts` (`contact_fields`), values on
  `contacts[].custom`. Everything that writes a value goes through
  `writeCustomValues` (`contactFieldValues.ts`), which checks it against its
  field, so built-ins can't be written that way and stay out of reach of inline
  edits: `sharedPeople.ts` sends those to a host, never `custom`. Which columns
  a table shows is workspace-wide (`contact_columns`, `contactColumns.ts`); a new
  field stays hidden unless it was made from a table or an import.
- **View-only sessions** (`src/viewOnly.ts`, `src/start.ts`) — the host's staff
  can open a copy from their admin portal to see what a customer sees, through
  a one-time link (`/auth/view`, `server/signInLink.ts`). The session lasts an
  hour and is kept in `view_sessions`, apart from `sessions`, so a version
  without this can't honour one. Two global middlewares refuse it every server
  function and route that isn't a GET, so a new endpoint needs nothing; a POST
  that only reads goes on the list in `viewOnly.ts`. A GET must check
  `isViewOnly` itself if it reaches outside this copy or hands out a link that
  acts on its own (`getSendingDomainsFn`, proposals).
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
