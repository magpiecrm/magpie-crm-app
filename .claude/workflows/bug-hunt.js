export const meta = {
  name: 'bug-hunt',
  description: 'Hunt for bugs in the areas a release changed, each on its own test stack, then re-check every finding before it counts',
  whenToUse: 'From the release-check skill, after the Playwright journeys pass. args: { repo, areas: [{ key, journeys, changes }], baseRef, headRef }',
  phases: [
    { title: 'Hunt', detail: 'one agent per changed area, on its own test stack, working its journeys then trying to break the change' },
    { title: 'Re-check', detail: 'each finding reproduced from its steps by a fresh agent on a fresh stack; not reproduced means dropped' },
  ],
}

// args.areas: [{ key: 'campaigns', journeys: ['M1', 'M2', 'C4'], changes: 'git log/diff summary for this area' }]
const areas = (args && args.areas) || []
const baseRef = (args && args.baseRef) || 'the last release tag'
const headRef = (args && args.headRef) || 'HEAD'
if (!areas.length) return { confirmed: [], dropped: [], coverage: [], note: 'No areas given: nothing to hunt.' }

// The checkout to test: its dist/ (already built) is what the stacks run.
const REPO = args && args.repo
if (!REPO) return { confirmed: [], dropped: [], coverage: [], note: 'args.repo (the checkout to test) is required.' }

const STACK_HOWTO = (port, reuse) => `
The test stack (read ${REPO}/test/README.md first, all of it): the production build run as a hosted customer's copy, with every outside service stood in for, so nothing real is reached and any click, send, search or AI call is free and safe. ${
  reuse
    ? `Yours is already running on port ${port}, with what the first agent made in it; use it and leave it running (it's stopped for you afterwards). Only if http://127.0.0.1:${port}/login doesn't answer, start it:`
    : `Start your own on port ${port}, never another port:`
}
  cd ${REPO} && (TEST_STACK_PORT=${port} nohup bun test/stack/up.ts --no-build${reuse ? " --keep" : ""} > /tmp/stack-${port}.log 2>&1 & echo $! > /tmp/stack-${port}.pid)
Wait for "[stack] ready" in /tmp/stack-${port}.log. Make a signed-in browser state with:
  cd ${REPO} && TEST_STACK_PORT=${port} bunx playwright test -c test/e2e/playwright.config.ts --project=setup
which writes /tmp/magpie-test-stack-${port}/auth.json. Drive the app with short Playwright scripts you write under ${REPO}/scratch/ (gitignored; delete them when done), e.g.
  import { chromium } from '@playwright/test'
  const b = await chromium.launch({ channel: 'chrome' })
  const page = await (await b.newContext({ storageState: '/tmp/magpie-test-stack-${port}/auth.json' })).newPage()
run with \`bun scratch/<file>.ts\`. Take screenshots and look at them (the Read tool shows images) to judge how things look, in light and dark (page.emulateMedia({ colorScheme })) and at phone width (viewport 390x844). Watch page.on('console') and page.on('pageerror').
Helpers you can import from your scripts: test/stack/mail.ts (sent() / waitForSent() for what the app sent; deliver() to put a reply in a sender's inbox; inbox()), test/e2e/helpers.ts (ensureSender(page): a ready sending domain, a sender and its connected inbox), test/stack/fixtures.ts (the made-up companies and people, and the address verification accepts for each). The stand-in host's call log is GET http://127.0.0.1:${port + 1}/__log and its controls POST /__control (README). Logs: /tmp/magpie-test-stack-${port}/app.log and host.log. Mailpit shows every sent email at http://127.0.0.1:${port + 80}.
Never print the stack's login. Stay on port ${port}: other agents are using other stacks. Don't edit anything under src/ or test/, don't commit, and don't touch .env or the user's real data. When you're done, leave the stack running: the re-check uses it, and it's stopped for you afterwards.`

const FINDINGS = {
  type: 'object',
  properties: {
    coverage: {
      type: 'array',
      description: 'Each journey or check you did, and how it went',
      items: {
        type: 'object',
        properties: { journey: { type: 'string' }, result: { type: 'string', enum: ['passed', 'failed', 'could not run'] }, note: { type: 'string' } },
        required: ['journey', 'result'],
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'One line: what is wrong, as a customer would notice it' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'polish'], description: 'blocker: loses data, sends wrongly, or a core journey fails; major: a feature doesn\'t work; minor: works with a wrinkle; polish: looks or reads wrong' },
          journey: { type: 'string', description: 'JOURNEYS.md id, or "exploratory"' },
          steps: { type: 'array', items: { type: 'string' }, description: 'Exact steps from a fresh stack, enough for someone else to reproduce' },
          expected: { type: 'string' },
          actual: { type: 'string' },
          evidence: { type: 'string', description: 'Console/log lines, screenshot path, request/response' },
          cause: { type: 'string', description: 'file:line of the likely cause, if found' },
        },
        required: ['title', 'severity', 'journey', 'steps', 'expected', 'actual'],
      },
    },
  },
  required: ['coverage', 'findings'],
}

const VERDICT = {
  type: 'object',
  properties: {
    reproduced: { type: 'boolean' },
    howSure: { type: 'string', enum: ['certain', 'likely', 'unsure'] },
    notes: { type: 'string', description: 'What you saw; if not reproduced, why (steps wrong, stand-in artefact, test-stack-only, intended behaviour)' },
    severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'polish'] },
  },
  required: ['reproduced', 'howSure', 'notes', 'severity'],
}

const huntPrompt = (area, port) => `You are hunting for bugs in MagpieCRM's ${area.key} area before a release (${baseRef}..${headRef}).

What changed in this area:
${area.changes || '(no summary given: read `git log --stat ' + baseRef + '..' + headRef + '` for files in this area)'}

Your journeys (in ${REPO}/test/JOURNEYS.md): ${area.journeys.join(', ')}. Read their full text there.
${STACK_HOWTO(port, false)}

Do this, in order:
1. Work through each of your journeys as a customer would, through the UI, and check every "must be true" it lists (in the app, in the mail caught, in the stand-in's log). Record each in coverage.
2. Then try to break what changed: empty and very long inputs, double clicks, going back mid-flow, reloading, leaving a page while something runs, the same action twice, phone width, dark mode, a stand-in failure (/__control fail) where the change talks to a service, and what a second user or a view-only session would see if relevant.
3. Look at each screen you touched in light, dark and at phone width; report what looks broken (overlaps, cut-off text, unreadable contrast, sideways scroll), not taste.

Report only what you saw happen, with exact steps from a fresh stack. Something you suspect but didn't see goes in a coverage note, not findings. Things that only happen because of the test stack itself (a stand-in's made-up answer, a .test domain) aren't app bugs: leave them out, or note them in coverage. Don't fix anything.`

const verifyPrompt = (f, area, port) => `Someone reported a bug in MagpieCRM's ${area} area. Your job is to check it independently: reproduce it from the steps, or show it doesn't happen. Assume it's wrong until you've seen it yourself; report reproduced=false if you can't make it happen, if it's down to the test stack rather than the app, or if it's intended behaviour (check the code and JOURNEYS.md).

Reported: ${f.title}
Severity claimed: ${f.severity}
Steps:
${f.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}
Expected: ${f.expected}
Actual: ${f.actual}
${f.evidence ? `Evidence: ${f.evidence}` : ''}
${f.cause ? `Suspected cause: ${f.cause}` : ''}
${STACK_HOWTO(port, true)}

Give the severity you'd give it yourself.`

// Each hunt runs a whole stack (app, two mail servers, a browser), so three areas at a time;
// an area's re-checks reuse its stack, and a last small step stops it.
const stopStack = (port) =>
  agent(`Stop the test stack on port ${port}: run \`kill -INT $(cat /tmp/stack-${port}.pid) 2>/dev/null; sleep 3; docker rm -f magpie-test-sent-${port} magpie-test-inboxes-${port} 2>/dev/null; fuser -k ${port}/tcp ${port + 1}/tcp 2>/dev/null; true\` and reply "stopped".`, {
    label: `stop:${port}`,
    phase: 'Re-check',
    effort: 'low',
  })

phase('Hunt')
const BATCH = 3
const results = []
for (let start = 0; start < areas.length; start += BATCH) {
  const batch = areas.slice(start, start + BATCH)
  const out = await pipeline(
    batch,
    (area, _, k) => agent(huntPrompt(area, 5200 + (start + k) * 100), { label: `hunt:${area.key}`, phase: 'Hunt', schema: FINDINGS }),
    (found, area, k) => {
      const port = 5200 + (start + k) * 100
      if (!found) return stopStack(port).then(() => ({ area: area.key, coverage: [], checked: [], failed: true }))
      log(`${area.key}: ${found.findings.length} finding(s), ${found.coverage.length} check(s)`)
      return parallel(
        found.findings.map((f, j) => () =>
          agent(verifyPrompt(f, area.key, port), { label: `re-check:${area.key}:${j + 1}`, phase: 'Re-check', schema: VERDICT }).then((v) => ({ ...f, area: area.key, verdict: v })),
        ),
      )
        .then((checked) => stopStack(port).then(() => checked))
        .then((checked) => ({ area: area.key, coverage: found.coverage, checked: checked.filter(Boolean) }))
    },
  )
  results.push(...out)
}

const done = results.filter(Boolean)
const order = { blocker: 0, major: 1, minor: 2, polish: 3 }
const all = done.flatMap((r) => r.checked)
const confirmed = all
  .filter((f) => f.verdict && f.verdict.reproduced)
  .map((f) => ({ ...f, severity: f.verdict.severity || f.severity }))
  .sort((a, b) => order[a.severity] - order[b.severity])
const dropped = all.filter((f) => !f.verdict || !f.verdict.reproduced).map((f) => ({ area: f.area, title: f.title, why: f.verdict ? f.verdict.notes : 'the re-check agent failed' }))
const missing = areas.filter((a) => !done.some((r) => r.area === a.key && !r.failed)).map((a) => a.key)
if (missing.length) log(`No hunt result for: ${missing.join(', ')}`)

return {
  confirmed,
  dropped,
  coverage: done.map((r) => ({ area: r.area, checks: r.coverage })),
  areasWithoutResult: missing,
}
