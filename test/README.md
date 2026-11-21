# Testing

Three layers, cheapest first:

| Layer | What | Run | Where |
|---|---|---|---|
| Unit | Server logic, parsers, rules | `bunx vitest run` (8 s) | `src/**/*.test.ts` |
| Journeys | The real app in a real browser, every outside service stood in for | `bun run e2e` | `test/e2e/*.e2e.ts` |
| Bug hunt | Agents work through `JOURNEYS.md` for what a release changed | `/release-check` | `.claude/skills/release-check/` |

`test/JOURNEYS.md` is the list of what has to work. A new feature adds its
journey there, and a Playwright journey when it can.

## The test stack

`bun run stack` (or `bun test/stack/up.ts`) runs the production build the way a
hosted customer's copy runs, with every outside service replaced:

| Real service | Stand-in |
|---|---|
| The host (verification, AI, sending domains, billing, shared database, signals, warmup) | `test/stack/host.ts` + `hostRoutes.ts` on port +1 |
| SocialFetch / the host's relay (people, companies, profiles) | the same stand-in |
| DNS (MX, SPF/DKIM/DMARC) | `test/stack/dns.ts` on UDP port +53 (`DNS_SERVERS`) |
| The mail server the app sends through | Mailpit (docker), SMTP port +25 with STARTTLS; web view on port +80 |
| Senders' inboxes (reply detection, Sent copies) | GreenMail (docker), IMAP port +43, SMTP port +26 to plant a reply |

Nothing in it reaches a real service or a real person: the app is started from
an empty environment (never `.env`), every address is a `.test` domain, and
all DNS is answered locally. Searches, reveals, sends and AI calls cost
nothing, so click anything.

- The app is on `http://127.0.0.1:4700` (or `TEST_STACK_PORT`). Two stacks can
  run side by side on different ports.
- Its database, logs (`app.log`, `host.log`) and throwaway login
  (`state.json`, mode 600) are in `/tmp/magpie-test-stack-<port>/`, wiped at
  each start (`--keep` keeps them). Never print the login; read it from there.
- `--self-hosted` runs it as a self-hoster's copy instead (own keys, no host;
  the copilot is off because its model APIs can't be stood in for).
- `--no-build` reuses `dist/`. Without it, the stack builds first.

### The made-up world

`test/stack/fixtures.ts`: six companies (`copperwick.test`,
`bramblefield.test`, …) with six people each. Each company has a real-looking
email format, except `quillmoor.test` (catch-all: verification says risky) and
`thistledown.test` (no mail server). Verification says `safe` only for the
address the company really uses (`realAddress()`), so reveal and save can be
checked exactly.

### Controlling and watching the stand-in host

- `GET /__log` (`?path=/v1/pool` to filter): every call the app made, with its
  body. Use it to check what left the app, e.g. that only verified people were
  contributed.
- `POST /__control`: `{"fail": {"/v1/check_email": 503}}` makes an endpoint
  fail; `{"rules": {...}}` changes the host's rules (`GET /v1/prospecting`);
  `{"ai": [{"text": "…"}, {"toolUse": {"name": "…", "input": {…}}}]}` queues
  the AI's next answers; `{"domainsReady": ["x.test"]}` makes a sending domain
  ready on its first check.
- `POST /__reset`: clears the log and every override.

The AI stand-in writes a plausible answer for each of the app's answer tools
(`writeEmail`, `suggestPersonas`, …) and a plain reply in chat.

### Mail

`test/stack/mail.ts`: `sent(to)` and `waitForSent(to)` read what the app sent
(Mailpit); `deliver()` puts an email into a sender's inbox (GreenMail), e.g. a
reply with `inReplyTo` set to a sequence email's Message-ID; `inbox(address,
folder)` reads one. Mailpit's web view (`state.mail.webUrl`) shows every email
rendered, for a person or agent to look at.

The scheduler sends once a minute, so a journey that waits for a campaign or
sequence email allows up to ~100 s. Reply detection has a "Check inboxes now"
button (Settings → Mailboxes), so nothing waits for its 3-minute poll.

## Writing a journey

- One file per area, `test/e2e/<area>.e2e.ts`, importing `test` and `expect`
  from `./fixtures` (adds `problems()` and `host`). End each test with
  `expect(problems()).toEqual([])`: no console errors or failed requests.
- Shared steps live in `helpers.ts` (`ensureSender()` sets up a ready domain,
  a sender and its connected inbox). Journeys share one workspace and run one
  at a time in any order, so every step must be safe to repeat; name what you
  make with `unique('…')`.
- Find things the way a person does: `getByRole`, `getByPlaceholder`,
  `getByText`. Much of the app's labels aren't tied to their inputs, so
  `getByLabel` often finds nothing; placeholders do. A page may show its
  empty state ("No … yet") while still loading: `waitForLoadState('networkidle')`
  before deciding something isn't there. Row buttons that appear on hover are
  `count()`ed, not `isVisible()`d.
- A journey that finds an app bug keeps asserting the right behaviour and is
  marked `test.fail(true, 'what's wrong')` until the fix lands (then it fails
  for passing, which is the reminder to remove the mark).

Run: `bun run e2e` (all), `bun run e2e -- campaigns` (one file),
`bun run e2e -- --project=phone` (phone size), `--headed` to watch. Failures
leave a trace: `bunx playwright show-trace <path>`; the HTML report is in the
stack's folder (`e2e-report/`).
