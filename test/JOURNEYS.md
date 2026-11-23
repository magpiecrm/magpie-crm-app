# Journeys

What "every feature works" means, written as things a customer does and what
must be true afterwards. This list is the release check: Playwright runs the
ones marked **auto** on every push (`test/e2e/`), and before a release the
bug hunt (`.claude/skills/release-check`) works through the rest for each
area the release changed, on the test stack (`test/README.md`).

**A new feature adds its journey here in the same change.** Write it as a
customer would do it, with checks you can see: in the app, in the mail the
stack caught (`test/stack/mail.ts`), or in what the stand-in host was asked
(`GET /__log` on the host).

Every page, every time (`test/e2e/pages.e2e.ts`, **auto**): it loads with no
console error and no failed request, in light, dark and at phone width, both
empty and with data.

The theme (`test/e2e/theme.e2e.ts`, **auto**): it follows the system's, even
as that changes, until one is picked with the toggle; the pick then lasts.

| Status | Meaning |
|---|---|
| **auto** | a Playwright journey covers it: name in brackets |
| hunt | not automated yet: the bug hunt does it by hand in the browser |
| real | needs a real outside service: dev copy only |

## Known bugs

Found by these journeys and not fixed yet. Each is a `test.fail` (or a `KNOWN`
entry in `pages.e2e.ts`) that starts failing once it's fixed: remove the mark
and the line here with the fix.

- **Seniority does nothing in a hosted copy's people search** (P1):
  `verifiedPeopleSource.ts` only logs `input.seniorities`; it neither sends nor
  filters by them.
- **Contacts saved from a hosted search are "found by Web"** (P3): saved with
  source `web`, which the Contacts filter doesn't label as Prospect search.
- **An import counts rows, not people** (C3): one person twice says "Imported 2
  contacts" (`addContactsToList`, `server/emailService.ts`).
- **Mailboxes says "No senders yet" while it's loading** (ST1), before the
  senders appear.

## Signing in

- **S1 Sign in and out** — auto [`signin`]. Right password opens Collection; wrong one says so and stays on the login page; signing out ends the session (going back doesn't reopen it).
- **S2 View-only session** — hunt. A view link from the host (`/auth/view`, minted with the stack's `SIGN_IN_LINK_SECRET`) opens the workspace; every change is refused with a clear message; it ends after an hour.
- **S3 Change password** — hunt. Settings → Team: the new one works, the old one doesn't.

## Contacts and lists

- **C1 Add and edit a contact** — auto [`contacts`]. Add one by hand; edit a field inline in the table; it shows on the contact page. Delete and Add to sequence act only on ticked contacts still in view: a search that hides one leaves it out, and choosing a list clears the ticks.
- **C2 Custom fields and columns** — hunt. Make a field from the table; give a contact a value; hide and show the column; a bad value for its type is refused.
- **C3 Import** — auto [`contacts`]. A CSV with a header row, a custom column and a duplicate: mapped, the duplicate merged, the count right, a new field made from the import.
- **C4 Unsubscribe** — auto [`campaigns`]. The link in a sent email unsubscribes them; they're left out of the next send; the List-Unsubscribe header is there.
- **L1 Fixed list** — auto [`lists`]. Make a list, add contacts to it, remove one.
- **L2 List from filters** — hunt. Filters preview a count before saving; saving fills the list once; a later matching contact joins only on "Add new matches"; a filter the list can't apply is refused, never "everyone".
- **CO1 Companies** — hunt. Contacts' companies appear on Companies; a company's page shows its people.

## Email content

- **T1 Template in the builder** — hunt. Add text, image, button and columns; change the global style; save; reopen unchanged; preview matches.
- **T2 Spam score** — hunt. A campaign preview shows the score; obviously spammy words and a missing unsubscribe lower it.

## Campaigns

- **M1 Send a campaign** — auto [`campaigns`]. To a list of three (one unsubscribed): two emails caught, each with the subject, a working unsubscribe link, a List-Unsubscribe header and a tracking pixel; the campaign shows sent with two recipients.
- **M2 Opens and clicks** — auto [`campaigns`]. Loading the pixel later than a minute after delivery counts an open; within a minute it's left out (automated); following a link counts a click and redirects; Analytics shows both. Analytics dates and its date range go by when a campaign was sent, not when it was drafted.
- **M3 Schedule and cancel** — hunt. Scheduled for later sends nothing now; cancelling keeps it a draft.
- **M4 Daily limit** — hunt (hosted). With the host's cold limit set low (`/__control`), the rest goes the next day and the campaign says so.
- **M5 Test email** — auto [`campaigns`]. "Send a test" from the campaign's Preview and test reaches only the address given, its subject marked `[TEST]` once; the list's people get nothing.

## Forms and surveys

- **F1 Form to contact** — auto [`forms`]. Build a form, publish it, fill it in at `/f/<id>`: a contact is made with the fields, and its welcome email is caught. A heading, intro, privacy link and thank-you page set before the first save show on the form, and sending it goes to that page. A form with "Add people to a list" off still sends its welcome email, and makes no contact. A form made from a template (Contact us) keeps the template's heading and intro.
- **F2 Embeds** — hunt. The iframe and pop-up snippets work on a plain page from another origin; hidden fields and the redirect apply.
- **SV1 Survey** — hunt. Build one with a branch rule; take it at `/s/<id>` both ways; results show both answers.

## Prospecting

- **P1 Search people by title** — auto [`prospecting`]. Results come from the stand-in; seniority and country filters narrow them; the next page shows new people, nobody twice.
- **P2 Reveal an email** — auto [`prospecting`]. Reveal finds the stand-in's verified address; an unverifiable domain says so; usage goes up by one lookup.
- **P3 Save to a list** — auto [`prospecting`]. Saved people become contacts with source "search"; a suppressed address is not saved; the host is sent only verified, saved people (`/__log` `/v1/pool/contribute`).
- **P4 Search inside companies** — hunt. Company filters and a single company search; signals badges (hiring, funding, warm) load after the results.
- **P5 Personas** — hunt. Draft a persona from a website (AI, stand-in): criteria fill in; using it fills the search filters.
- **P6 Prospect search by AI** — hunt. Start it, leave the page, the bell says it's done, the suggestions are there.

## Sequences and replies

- **Q1 Sequence first emails** — auto [`sequences`]. Two steps; enrol two contacts; both first emails are caught within a few minutes (a sequence sends one email per scheduler run, at least a minute apart), from the sender, each with an unsubscribe link.
- **Q2 Reply detection** — auto [`sequences`]. A reply delivered to the sender's connected inbox (GreenMail) is found: the enrolment stops, the reply shows in Sell → Inbox and the sequence's Replies tab.
- **Q3 Answer a reply** — auto [`sequences`]. Answering from the Inbox sends from the sender, threaded under their message (In-Reply-To), with a copy in the inbox's Sent folder.
- **Q4 Follow-ups** — hunt. A follow-up waits its delay and isn't sent to someone who replied.
- **Q5 Personalised emails** — hunt. With AI writing on, each person's draft is written (stand-in AI) and sent once it passes the checks.

## Sales

- **D1 Deals and pipeline** — hunt. Make a deal from a contact, drag it across stages, its page logs the moves.
- **D2 Tasks** — hunt. Add one with a due time; complete it; a due one reminds.
- **D3 Proposals** — hunt. Make one, open its public link signed out, accept it; the deal shows accepted.

## Copilot and API

- **A1 Copilot** — hunt. Ask it to make a list: the stand-in AI asks for the tool, the approval shows, approving makes the list.
- **A2 MCP** — hunt. An MCP-scoped API key lists the public tools at `/api/mcp`; another key is refused.

## Settings

- **ST1 Sender and sending domain** — auto [`settings`] (hosted). Add a sender; its domain shows the DNS records; "Check now" turns it ready (stand-in); sending from it works.
- **ST2 Connect an inbox** — auto [`sequences`]. Mailboxes: connect the sender's inbox (GreenMail IMAP, no TLS); it shows connected.
- **ST3 Overview and usage** — hunt. Counts on Overview match what the journeys did; with an allowance set, the meters show it and going over refuses with a clear message.
- **ST4 Plan and billing** — hunt (hosted). The plan from the stand-in shows; add-ons offered.
- **ST5 Warmup** — hunt (hosted). A sender with a ready domain and connected inbox can switch warmup on after agreeing; one that isn't ready says why.
- **ST6 API keys and team** — hunt. Make and revoke a key; invite someone. Removing a person signs them out everywhere: their open browser goes to the sign-in page at its next click.

## Dev copy only (real)

What the stand-ins can't prove, done once per release on `dev.magpiecrm.com`
with your own addresses: one real people search, one real reveal, one campaign
and one sequence email to your own inbox (it arrives, not in spam, links work),
a reply to it detected.

## Demo copy only (real)

`demo.magpiecrm.com` (`DEMO_MODE=on`, made-up data from `bun run demo:seed`),
checked after deploying a build to it: a real people search shows every name,
company and title's employer starred and no profile links, in the page and in
what the server sent (`demoMask.test.ts` covers the shapes); Reveal shows a
starred email; Save is off; sending a draft campaign sends nothing; Settings
shows the plan's meters, a ready sending domain and a good reputation.
