# MagpieCRM

A web app for sourcing B2B prospects, managing contact lists, and building &
sending email campaigns. Built with [TanStack Start](https://tanstack.com/start)
(React 19 + TanStack Router/Query), Tailwind CSS v4, and a self-hosted server
layer:

- Contacts, lists, and campaigns live in the app's own JSON DB
  (`src/server/db.ts`) and send over plain SMTP (`nodemailer.ts`) — no
  third-party ESP.
- **[SocialFetch](https://www.socialfetch.dev/)** — the only source of company and
  people data for prospect search. Emails are generated from name + company
  domain and, optionally, verified with a self-hosted
  [Reacher](https://github.com/reacherhq/check-if-email-exists) instance.

There is also a copilot, an agent running on Claude or OpenAI models with
your own API key, that can search prospects, create lists/campaigns/personas,
edit the email builder canvas, and more. The same tools are available to outside
AI apps (Claude Code and Desktop, ChatGPT/OpenAI, Cursor, …) over MCP.

## Getting started

```bash
bun install
bun run dev          # dev server on http://localhost:3000
```

Create a `.env` file in the project root:

```bash
SMTP_HOST=...            # optional — SMTP sending; or set any provider in
SMTP_PORT=...            # Settings → Sending, which overrides these
SMTP_USER=...
SMTP_PASS=...
SMTP_SENDER=...          # optional — added to Settings → Sender addresses on first start
SES_ACCESS_KEY_ID=...    # optional — send through Amazon SES without saving it
SES_SECRET_ACCESS_KEY=...#   in Settings → Sending (also SES_REGION, default
                         #   us-east-1, and SES_CONFIGURATION_SET)
SES_MESSAGE_TAGS=...     # optional — "name=value,…" tags on every email SES
                         #   sends, returned on its bounce/complaint events
EMAIL_PROVIDER=...       # optional — provider id to use when none is saved
                         #   (e.g. ses); otherwise inferred from the vars above
SENDING_MANAGED=on       # optional — the host sends through its SES_* account:
                         #   Settings → Sending shows only sending domains, which
                         #   users verify with DNS records, and mail only goes
                         #   out from them. The SES keys need ses:SendEmail,
                         #   ses:CreateEmailIdentity and ses:GetEmailIdentity
SOCIALFETCH_API_KEY=...  # optional — or add it in Settings → Data source (sfk_...)
SOCIALFETCH_BALANCE=hidden # optional — don't show the credit balance (someone
                         #   else pays); the sidebar shows this month's prospects
SUPPRESSION_SECRET=...   # recommended — keys the opt-out/suppression hashes;
                         # falls back to TRACKING_SECRET. Never rotate it.
REACHER_URL=...          # optional — or set in Settings → Email verification;
                         # e.g. http://reacher:8080; enables email
                         # verification. Without it, emails are saved as
                         # "unverified" best guesses.
REACHER_SECRET=...       # optional — matches RCH__HEADER_SECRET on Reacher
REACHER_FROM_EMAIL=...   # optional — SMTP FROM used for verification
REACHER_HELLO_NAME=...   # optional — EHLO name; should match the proxy's PTR
ANTHROPIC_API_KEY=...    # optional — the copilot's Claude key; or set in Settings → Copilot
OPENAI_API_KEY=...       # optional — the copilot's OpenAI key; or set in Settings → Copilot
REACHER_PROXIES=...      # optional — JSON array of SOCKS5 proxies:
                         # [{"host":"1.2.3.4","port":1080,"username":"u","password":"p","label":"eu-1"}]
AUTH_EMAIL=...           # required — the first login. Change passwords and
AUTH_PASSWORD=...        # add people in Settings → Team and login; changing
                         # AUTH_PASSWORD resets that login's password on the
                         # next restart (for a forgotten password).
TRACKING_SECRET=...      # required in production — signs tracking/unsubscribe links
                         # and encrypts stored provider credentials.
                         # Generate with: openssl rand -hex 32
CREDENTIALS_SECRET=...   # optional — separate key for stored credentials
WEBHOOK_SECRET=...       # strongly recommended — without it the bounce/provider
                         # webhooks accept requests from anyone
PUBLIC_URL=...           # optional — this app's public origin, for links in emails
PUBLIC_SITE_URL=...      # optional — your website; unsubscribe page links back to it
SUBSCRIBE_ALLOWED_ORIGINS=...  # optional — comma-separated origins allowed to
                               # embed the signup form (POST /api/subscribe)
DATABASE_PATH=...        # optional — defaults to ./local_db.json
USAGE_API_TOKEN=...      # optional — turns on GET /api/usage (monthly usage
                         # counts, e.g. for a hosting provider's billing) and
                         # /api/usage/allowance (monthly limits a host sells
                         # up front; see src/server/allowance.ts) and
                         # /api/usage/suppressions (opt-outs a host passes
                         # between its copies)
PROSPECTING_MANAGED=on   # optional — the host runs prospect data and email
                         # verification: hides those settings (implies
                         # SOCIALFETCH_BALANCE=hidden, VERIFICATION_HEALTH_CHECKS=off)
VERIFICATION_HEALTH_CHECKS=off  # optional — skip blocklist/DNS checks of the
                         # verifying IPs, when someone else runs verification
SIGN_IN_LINK_SECRET=...  # optional — shared with a hosting portal: turns on
                         # one-time sign-in links at /auth/link (format in
                         # src/server/signInLink.ts). At least 32 characters
PASSWORD_LOGIN=off       # optional — no password sign-in; people come in
                         # through links from the host's portal
SIGN_IN_URL=...          # optional — where the sign-in page sends people when
                         # PASSWORD_LOGIN=off (the host's portal)
```

In production the app refuses to sign or encrypt anything until
`TRACKING_SECRET` (or `CREDENTIALS_SECRET`) is set, rather than falling back to a
key that anyone reading this source would know. Rotating either secret makes
previously stored provider credentials unreadable, so set them once, up front.
Secrets are deliberately not editable in the app: set them where you deploy.

See `src/server/env.ts` for the full list, including optional web push (VAPID)
and Cloudflare settings.

### Bounce handling (optional)

`cloudflare-worker/worker.js` is a Cloudflare Email Worker that parses bounce
notifications and forwards them to this app. Deploy it with two variables set
in Cloudflare: `BOUNCE_WEBHOOK_URL` (e.g.
`https://your-app.example.com/api/webhooks/bounce`) and `WEBHOOK_SECRET`
(matching the app's).

Sending providers post bounces to `/api/webhooks/email/<provider>` (with
`?s=<WEBHOOK_SECRET>`). For Amazon SES: a configuration set
(`SES_CONFIGURATION_SET`) publishing Bounce and Complaint events to an SNS
topic with an HTTPS subscription to `/api/webhooks/email/ses?s=…`; the app
confirms the subscription itself. A hard bounce marks the contact bounced; a
spam complaint unsubscribes them.

### Copilot and AI apps (MCP)

The copilot runs on Claude or OpenAI models, with **your own API key** for
either (Settings → Copilot), and you pick the model in the chat. Usage is
billed to the key's owner. The app calls the Anthropic or OpenAI API itself
and runs the tools in-process, so there's nothing else to install.

- **Claude:** an Anthropic API key (or `ANTHROPIC_API_KEY`) from the
  [Claude Console](https://platform.claude.com/). Never a Claude.ai login:
  Anthropic's terms don't allow apps to offer or relay Claude.ai sign-in, or
  to share one Pro/Max subscription between users
  ([details](https://code.claude.com/docs/en/legal-and-compliance)).
- **OpenAI** (GPT-6): an OpenAI API key (or `OPENAI_API_KEY`) from the
  [OpenAI platform](https://platform.openai.com/api-keys). Requests use
  `store: false`.

**Settings → Connect AI apps** connects outside AI apps to the same tools over
MCP at `/api/mcp` (Streamable HTTP). Create a key per app there and copy the
ready-made setup for Claude Code, Claude Desktop, Cursor, the OpenAI Codex CLI
or the OpenAI Responses API; anything else that speaks MCP over HTTP works with
`Authorization: Bearer <key>`. MCP keys are separate from the public API keys
used by signup forms, and can be revoked individually. Tools that only work
against a design open in the browser stay inside the app's own copilot. Apps
that connect from the cloud (the OpenAI API, ChatGPT, Claude on the web) need
the app on a public https address, and ChatGPT/claude.ai connectors also need
an OAuth sign-in flow that isn't built yet.

### Prospect search and data protection

Add your SocialFetch API key in **Settings → Data source** (it's stored
encrypted in the database with `CREDENTIALS_SECRET` and takes priority over the
`SOCIALFETCH_API_KEY` env var). "Test connection" checks it against
SocialFetch's free balance endpoint. The Reacher and proxy settings live on the
same tab.

People search looks up every result's profile for their real current title and
company (3 credits per result, on top of 3 per search page). **Reveal email**
on a result finds and verifies that person's address without saving them;
saving reuses it.

Emails are verified by a self-hosted Reacher (`bun run reacher:up`, free),
ideally through SOCKS5 proxies on servers with a clean IP. See
[docs/proxies.md](docs/proxies.md) for setup, reverse DNS, rate limits and IP
reputation.

Prospect search runs company search → people search → save to list. Search
results are fetched live from SocialFetch and never stored; only saving creates
contacts, and that is the only point where emails are looked up.

- **Email finding**: candidates are ranked from the person's name (accents,
  hyphens, apostrophes and surname particles handled) and checked through
  Reacher until one comes back `safe`. A verified address teaches the domain its
  pattern (e.g. `{first}.{last}`), cached globally *without* any name or
  address; catch-all status and MX are cached per domain too.
- **Statuses**: `verified`, `catch_all_likely`, `risky`, `unverified` (no
  Reacher, or greylisted), `not_found` (not saved).
- **Suppression**: `/api/opt-out` is a public page where anyone can opt out by
  email, LinkedIn URL, or name + company website. Identifiers are stored only as
  HMAC hashes (`SUPPRESSION_SECRET`), matching saved contacts are deleted, and
  suppressed people are filtered out of search results and blocked at save.
  A host running several copies can give them one `SUPPRESSION_SECRET` and pass
  opt-outs between them through `/api/usage/suppressions`, so an opt-out from
  one copy applies to all of them.
- **Disclosure log**: every prospected contact saved gets a hashed log entry
  (sources, timestamp, notice status). New contacts start with
  `notice_status = pending`; nothing yet delivers the notice.

Self-hosting this makes you the data controller for prospected contacts under
UK GDPR and PECR, and you must also comply with SocialFetch's terms.

## Scripts

| Command          | Description                          |
| ---------------- | ------------------------------------ |
| `bun run dev`    | Start the dev server (port 3000)     |
| `bun run build`  | Production build                     |
| `bun run start`  | Run the production build (`serve.ts`) |
| `bun run preview`| Preview the build with Vite (dev use) |
| `bun run test`   | Run the Vitest suite                 |
| `bun run knip`   | Find unused files/exports/deps       |

## Project layout

```
src/
  routes/            File-based routes (TanStack Router)
    marketing/       Contacts, lists, campaigns, analytics
    collection/      Prospect collection / saved lists
  features/          Self-contained feature modules
    prospects/       Prospect search UI (companies → people → save) + constants
    email-builder/   Block-based email designer (canvas, blocks, compiler)
    copilot/         AI chat panel
  components/        Shared components + ui/ primitive library
  server/            Server functions, self-hosted data layer, copilot backend
    db.ts            JSON-file data store (contacts, lists, campaigns, ...)
    emailService.ts  Campaign send pipeline (reads db.ts, sends via nodemailer)
    nodemailer.ts    SMTP transport
    prospecting/     SocialFetch connector, email finder, Reacher client,
                     proxy router, suppression + disclosure log, save jobs
    env.ts           Centralized API keys + base URLs
    functions/       createServerFn endpoints, split by domain
    copilot/         copilot agent loop (Anthropic/OpenAI), tools, MCP server
  queryKeys.ts       Centralized TanStack Query key factory
```

Server functions are defined with `createServerFn` in `src/server/functions/`
and re-exported from `src/server/functions/index.ts`, so callers import them as
`from '.../server/functions'`.

## Styling

Tailwind CSS v4 (configured via `@tailwindcss/vite`). Global tokens and theme
live in `src/styles.css`.

## Releases and security

Run a released version (`ghcr.io/magpiecrm/magpie-crm-app:<version>`) rather
than `latest`; see [RELEASING.md](RELEASING.md) for how versions are cut.
Report vulnerabilities privately: see [SECURITY.md](SECURITY.md).

## License

[GNU Affero General Public License v3.0](LICENSE). You can use, change and
self-host it; if you run a modified version as a service for others, you must
make your changes available to them under the same license.
