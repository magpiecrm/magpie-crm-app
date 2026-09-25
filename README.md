# Email Marketing

A web app for sourcing B2B prospects, managing contact lists, and building &
sending email campaigns. Built with [TanStack Start](https://tanstack.com/start)
(React 19 + TanStack Router/Query), Tailwind CSS v4, and a self-hosted server
layer:

- Contacts, lists, and campaigns live in the app's own JSON DB
  (`src/server/db.ts`) and send over plain SMTP (`nodemailer.ts`) — no
  third-party ESP.
- **[Generect](https://generect.com/)** — LinkedIn-based prospect ("lead") search and account usage.

There is also a copilot that drives a locally installed `claude` CLI as a
long-lived agent with its own MCP tool server, letting it search prospects,
create lists/campaigns/personas, edit the email builder canvas, and more.

## Getting started

```bash
bun install
bun run dev          # dev server on http://localhost:3000
```

Create a `.env` file in the project root:

```bash
SMTP_HOST=...            # required for sending campaigns
SMTP_PORT=...
SMTP_USER=...
SMTP_SENDER=...
GENERECT_API_KEY=...     # required for prospect search
AUTH_EMAIL=...           # required — app login
AUTH_PASSWORD=...
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
```

In production the app refuses to sign or encrypt anything until
`TRACKING_SECRET` (or `CREDENTIALS_SECRET`) is set, rather than falling back to a
key that anyone reading this source would know. Rotating either secret makes
previously stored provider credentials unreadable, so set them once, up front.

See `src/server/env.ts` for the full list, including optional web push (VAPID)
and Cloudflare settings.

### Bounce handling (optional)

`cloudflare-worker/worker.js` is a Cloudflare Email Worker that parses bounce
notifications and forwards them to this app. Deploy it with two variables set
in Cloudflare: `BOUNCE_WEBHOOK_URL` (e.g.
`https://your-app.example.com/api/webhooks/bounce`) and `WEBHOOK_SECRET`
(matching the app's).

The copilot additionally requires the `claude` CLI to be installed and
authenticated on the host running the dev server.

## Scripts

| Command          | Description                          |
| ---------------- | ------------------------------------ |
| `bun run dev`    | Start the dev server (port 3000)     |
| `bun run build`  | Production build                     |
| `bun run preview`| Preview the production build         |
| `bun run test`   | Run the Vitest suite                 |
| `bun run knip`   | Find unused files/exports/deps       |

## Project layout

```
src/
  routes/            File-based routes (TanStack Router)
    marketing/       Contacts, lists, campaigns, analytics
    collection/      Prospect collection / saved lists
  features/          Self-contained feature modules
    prospects/       Prospect search UI + industry constants
    email-builder/   Block-based email designer (canvas, blocks, compiler)
    copilot/         AI chat panel
  components/        Shared components + ui/ primitive library
  server/            Server functions, self-hosted data layer, copilot backend
    db.ts            JSON-file data store (contacts, lists, campaigns, ...)
    emailService.ts  Campaign send pipeline (reads db.ts, sends via nodemailer)
    nodemailer.ts    SMTP transport
    generect.ts      Generect REST client
    env.ts           Centralized API keys + base URLs
    functions/       createServerFn endpoints, split by domain
    copilot/         claude CLI session management + MCP tool server
  queryKeys.ts       Centralized TanStack Query key factory
```

Server functions are defined with `createServerFn` in `src/server/functions/`
and re-exported from `src/server/functions/index.ts`, so callers import them as
`from '.../server/functions'`.

## Styling

Tailwind CSS v4 (configured via `@tailwindcss/vite`). Global tokens and theme
live in `src/styles.css`.
