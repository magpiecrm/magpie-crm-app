---
name: release-check
description: Check a release of the app before it ships. Typecheck, unit tests and build in a clean worktree, every Playwright journey on the test stack, then a bug hunt by agents over each area the release changed, every finding re-checked before it counts. Use before tagging a release, or when asked to "test everything", "check the release" or "run the release check".
---

# Release check

Everything here runs on the test stack (`test/README.md`): the production
build with every outside service stood in for, so nothing real is reached and
nothing costs anything. What the stand-ins can't prove is done on the dev copy
afterwards (step 7).

Read `test/README.md` and `test/JOURNEYS.md` before you start.

## 1. What's being released

- `BASE` = the last release tag: `git describe --tags --abbrev=0 origin/main`.
- `HEAD` = the commit to release (usually `origin/main`; `git fetch` first).
- `git log --oneline BASE..HEAD` and `git diff --stat BASE..HEAD`: say in a
  line or two what changed.

## 2. A clean checkout

Never test the working copy (other sessions' changes, untracked files). Use the
release-check worktree (`CLAUDE.local.md` → Releasing the app, step 2), or make
one: `git worktree add --detach /tmp/magpie-release-check HEAD`, then
`bun install --frozen-lockfile` in it the first time. Check out `HEAD` there.

In it, all must pass:

```bash
bunx tsc --noEmit && bunx vitest run && bun run build
```

A failure stops the check here: report it and what failed.

## 3. The journeys

Still in the worktree, with nothing else on its ports (another session may be
running a stack: `docker ps --filter name=magpie-test-` shows them; pick a free
`TEST_STACK_PORT` if 4700 is taken):

```bash
bun run e2e -- --project=setup --project=desktop --project=phone
```

The stack starts by itself and stops at the end. All must pass. Tests marked
`test.fail` are known bugs: list them in the report. A real failure: open its
trace (`bunx playwright show-trace <path>`), say what broke, and stop unless
the user says to go on. Look over the page screenshots it leaves in
`/tmp/magpie-test-stack-<port>/pages/` for anything that looks broken.

## 4. Which areas changed

Map `git diff --name-only BASE..HEAD` to areas (a file can touch several):

| Area key | Paths | Journeys |
|---|---|---|
| access | `src/routes/login.tsx`, `src/routes/auth/`, `src/server/auth*`, `signInLink.ts`, `viewOnly.ts`, `ownPages.ts`, `start.ts` | S1–S3 |
| contacts | `src/features/contacts/`, `src/routes/marketing/contacts*`, `lists/`, `companies/`, `server/listBuilder.ts`, `contactField*`, `functions/contacts.ts`, `functions/lists.ts` | C1–C4, L1, L2, CO1 |
| content | `src/features/email-builder/`, `templates/`, `spam-score/`, `server/spamScore/` | T1, T2 |
| campaigns | `src/features/campaigns/`, `routes/marketing/campaigns/`, `routes/marketing/analytics/`, `server/emailService.ts`, `nodemailer.ts`, `providers/`, `sendingLimits.ts`, `sendingReputation.ts`, `routes/api/track/`, `unsubscribe.ts` | M1–M5, C4 |
| forms | `src/features/forms/`, `survey-builder/`, `surveys/`, `routes/f/`, `routes/s/`, `routes/api/form-submit/`, `routes/api/survey*`, `public/forms/`, `public/surveys/` | F1, F2, SV1 |
| prospecting | `src/features/prospects/`, `routes/collection/`, `server/prospecting/` | P1–P6 |
| sequences | `src/features/sequences/`, `features/inbox/`, `routes/sales/sequences/`, `routes/sales/inbox.tsx`, `server/sequences/`, `server/mailboxes/` | Q1–Q5, ST2 |
| sales | `src/features/sales/`, `routes/sales/deals/`, `pipeline.tsx`, `tasks.tsx`, `proposals/`, `server/sales/` | D1–D3 |
| copilot | `src/features/copilot/`, `server/copilot/`, `routes/api/copilot/`, `routes/api/mcp.ts` | A1, A2 |
| settings | `src/features/settings/`, `routes/settings.tsx`, `server/inboxWarmup.ts`, `managedBilling.ts`, `sendingDomains.ts`, `usage.ts`, `allowance.ts`, `routes/api/usage*` | ST1, ST3–ST6 |

- Shared code (`src/components/`, `src/styles.css`, `server/db.ts`,
  `queryKeys.ts`, `functions/index.ts`): add the areas that use what changed
  (read the diff), not all of them.
- Tests, docs, `test/` and `.claude/` alone: no area.
- For each area, write `changes`: the commits and a few lines on what the diff
  does there. This is all the hunting agent knows about the change.

Tell the user the areas and what the hunt will cost before starting it: one
agent per area, one per finding to re-check, three areas at a time, each with
its own stack (about 1 GB of memory each).

## 5. The bug hunt

```
Workflow({
  scriptPath: '.claude/workflows/bug-hunt.js',
  args: { repo: '<the worktree's absolute path>', baseRef: BASE, headRef: HEAD,
          areas: [{ key: 'campaigns', journeys: ['M1', 'M2', 'C4'], changes: '…' }, …] }
})
```

It returns `confirmed` (reproduced by a second agent, by severity), `dropped`
(not reproduced, and why) and `coverage` (each journey each agent did). Read
the confirmed ones yourself before reporting them: open the code at the cause
and make sure the steps hold up.

Afterwards, make sure no stack is left: `docker ps --filter name=magpie-test-`
should show none of the hunt's ports (5200 and up); stop any that are
(`docker rm -f`, and `fuser -k <port>/tcp`).

## 6. Report

Write the report to the session's scratch folder and give the user its path,
plus in chat:

- the range and what it changes, in two lines;
- checks: typecheck, unit, build, journeys (passed / failed / known bugs);
- confirmed findings, worst first: title, area, steps, expected vs actual,
  cause if known;
- what wasn't covered (a journey that couldn't run, an area with no result);
- a verdict: **blockers or majors mean don't release** until fixed. Minor and
  polish findings: the user decides.

For each confirmed bug, the fix is separate work: offer it, don't start it.

## 7. The dev copy

What the stand-ins can't prove (`JOURNEYS.md` → Dev copy only) is checked on
the dev copy, with the user's own addresses only: see `CLAUDE.local.md` → The
dev copy. Deploying a build there and the real searches and sends are the
user's to approve: list them and ask.
