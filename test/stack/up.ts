// The test stack: the app's production build, with every outside service
// stood in for, so anything in it can be clicked, sent or searched for free and
// nobody real is reached.
//
//   bun test/stack/up.ts                 hosted mode (as a customer's copy runs), port 4700;
//                                        builds first if the source is newer than dist/
//   bun test/stack/up.ts --self-hosted   own keys instead of a host
//   bun test/stack/up.ts --no-build      use dist/ as it is, even if the source is newer
//   bun test/stack/up.ts --keep          keep the last run's data instead of starting empty
//   TEST_STACK_PORT=4800 bun test/stack/up.ts   a second stack beside the first
//
// It runs until stopped (Ctrl-C), then stops everything it started.
//
//   app        http://127.0.0.1:<port>          the build, run by serve.ts as production runs it
//   host       http://127.0.0.1:<port+1>        host.ts: SocialFetch, verification, AI, sending, billing…
//   dns        udp 127.0.0.1:<port+53>          dns.ts, run by host.ts: the made-up domains' records
//   sent mail  Mailpit in docker                SMTP <port+25> (STARTTLS); every email the app sends
//                                               lands here, whoever it's to; web view <port+80>
//   inboxes    GreenMail in docker              the senders' inboxes: IMAP <port+43> for reply
//                                               detection, SMTP <port+26> to deliver a reply into one
//
// Its database, login and logs are in a folder of its own (state.ts
// `stackDir`), wiped at each start unless --keep. The login is made up for each
// run and written there in state.json (mode 600), never printed.

import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import { chmodSync, existsSync, mkdirSync, openSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { basePort, stackDir, type StackState } from './state'

const args = new Set(process.argv.slice(2))
const known = ['--self-hosted', '--no-build', '--keep']
const unknown = [...args].filter((a) => !known.includes(a))
if (unknown.length) {
  console.error(`Unknown option ${unknown.join(' ')}. Options: ${known.join(' ')}`)
  process.exit(1)
}

const root = resolve(import.meta.dir, '../..')
const port = basePort()
const ports = { app: port, host: port + 1, dns: port + 53, smtp: port + 25, mailWeb: port + 80, inboxSmtp: port + 26, imap: port + 43, inboxApi: port + 81 }
const mode: StackState['mode'] = args.has('--self-hosted') ? 'self-hosted' : 'hosted'
const dir = stackDir(port)
const containers = { sent: `magpie-test-sent-${port}`, inboxes: `magpie-test-inboxes-${port}` }
const MAILPIT = 'axllent/mailpit:v1.31.3'
const GREENMAIL = 'greenmail/standalone:2.1.14'

const children: ChildProcess[] = []
// Set once this run starts its own containers: until then, any with these names are another run's.
let ownContainers = false
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const c of children) c.kill('SIGTERM')
  if (ownContainers) spawnSync('docker', ['rm', '-f', containers.sent, containers.inboxes], { stdio: 'ignore' })
  process.exit(code)
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

function fail(message: string): never {
  console.error(`[stack] ${message}`)
  stop(1)
  process.exit(1)
}

async function waitFor(url: string, what: string, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs
  for (;;) {
    try {
      const res = await fetch(url)
      if (res.status < 500) return
    } catch {}
    if (Date.now() > until) fail(`${what} didn't come up at ${url} within ${timeoutMs / 1000}s (logs in ${dir})`)
    await new Promise((r) => setTimeout(r, 500))
  }
}

function portFree(p: number) {
  const r = spawnSync('bash', ['-c', `exec 3<>/dev/tcp/127.0.0.1/${p}`], { stdio: 'ignore' })
  return r.status !== 0
}

// ── Folder ──────────────────────────────────────────────────────────────────
for (const [name, p] of Object.entries(ports)) {
  if (!portFree(p)) fail(`port ${p} (${name}) is in use. Is a stack already running? Stop it, or set TEST_STACK_PORT.`)
}
if (!args.has('--keep')) rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true, mode: 0o700 })
const log = (name: string) => openSync(join(dir, `${name}.log`), 'a')

// ── Build ───────────────────────────────────────────────────────────────────
// Built again only when something it's built from is newer than the last build
// (or there isn't one); --no-build uses whatever dist/ holds.
function newest(path: string): number {
  const st = statSync(path)
  if (!st.isDirectory()) return st.mtimeMs
  let max = st.mtimeMs
  for (const name of readdirSync(path)) if (!name.startsWith('.')) max = Math.max(max, newest(join(path, name)))
  return max
}
const built = join(root, 'dist/server/server.js')
const builtAt = existsSync(built) ? statSync(built).mtimeMs : 0
const sources = ['src', 'public', 'package.json', 'vite.config.ts', 'bun.lock'].map((p) => join(root, p)).filter(existsSync)
const stale = !builtAt || Math.max(...sources.map(newest)) > builtAt
if (stale && !(args.has('--no-build') && builtAt)) {
  console.log(`[stack] building the app (bun run build)${builtAt ? ': the source is newer than dist/' : ''}…`)
  const b = spawnSync('bun', ['run', 'build'], { cwd: root, stdio: ['ignore', log('build'), log('build')] })
  if (b.status !== 0) fail(`the build failed: see ${join(dir, 'build.log')}`)
} else {
  console.log(`[stack] using the build from ${new Date(builtAt).toLocaleString()}${stale ? ' (older than the source: --no-build)' : ''}`)
}

// ── Mail ────────────────────────────────────────────────────────────────────
// A hosted copy's sending insists on STARTTLS, so Mailpit gets a certificate made for this run.
const certs = join(dir, 'certs')
mkdirSync(certs, { recursive: true })
const cert = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=127.0.0.1', '-keyout', join(certs, 'key.pem'), '-out', join(certs, 'cert.pem')], { stdio: 'ignore' })
if (cert.status !== 0) fail('openssl could not make the mail server a certificate')
chmodSync(join(certs, 'key.pem'), 0o644) // read by the container's own user

// Left behind by a run that didn't stop cleanly (its ports were free, so nothing is using them).
ownContainers = true
spawnSync('docker', ['rm', '-f', containers.sent, containers.inboxes], { stdio: 'ignore' })
const sentMail = spawnSync('docker', [
  'run', '-d', '--name', containers.sent,
  '-v', `${certs}:/certs:ro`,
  '-p', `127.0.0.1:${ports.smtp}:1025`,
  '-p', `127.0.0.1:${ports.mailWeb}:8025`,
  MAILPIT,
  '--smtp-tls-cert', '/certs/cert.pem', '--smtp-tls-key', '/certs/key.pem',
  '--smtp-auth-accept-any', '--smtp-auth-allow-insecure', '--max', '10000',
], { encoding: 'utf8' })
if (sentMail.status !== 0) fail(`couldn't start Mailpit (is docker running?): ${sentMail.stderr.trim()}`)
const inboxes = spawnSync('docker', [
  'run', '-d', '--name', containers.inboxes,
  '-e', 'GREENMAIL_OPTS=-Dgreenmail.setup.test.smtp -Dgreenmail.setup.test.imap -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.auth.disabled',
  '-p', `127.0.0.1:${ports.inboxSmtp}:3025`,
  '-p', `127.0.0.1:${ports.imap}:3143`,
  '-p', `127.0.0.1:${ports.inboxApi}:8080`,
  GREENMAIL,
], { encoding: 'utf8' })
if (inboxes.status !== 0) fail(`couldn't start GreenMail: ${inboxes.stderr.trim()}`)
console.log(`[stack] sent mail: SMTP ${ports.smtp}, http://127.0.0.1:${ports.mailWeb}; inboxes: IMAP ${ports.imap}`)

// ── Stand-in host ───────────────────────────────────────────────────────────
const hostSecret = randomBytes(24).toString('hex')
// The app's webhook secret: the stand-in host uses it to report deliveries, as the real one does.
const webhookSecret = randomBytes(32).toString('hex')
const host = spawn('bun', [join(import.meta.dir, 'host.ts')], {
  cwd: root,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, HOST_PORT: String(ports.host), DNS_PORT: String(ports.dns), HOST_SECRET: hostSecret, APP_URL: `http://127.0.0.1:${ports.app}`, MODE: mode, MAILPIT_URL: `http://127.0.0.1:${ports.mailWeb}`, WEBHOOK_SECRET: webhookSecret },
  stdio: ['ignore', log('host'), log('host')],
})
children.push(host)
host.on('exit', (code) => !stopping && fail(`the stand-in host stopped (${code}): see ${join(dir, 'host.log')}`))

// ── App ─────────────────────────────────────────────────────────────────────
const login = { email: 'tester@magpie.test', password: randomBytes(12).toString('base64url') }
const dbPath = join(dir, 'local_db.json')
const hostUrl = `http://127.0.0.1:${ports.host}`
const secret = () => randomBytes(32).toString('hex')

// Only what's listed here reaches the app: never this machine's .env (serve.ts is run with
// --no-env-file, and the environment is built from nothing).
const appEnv: Record<string, string> = {
  PATH: process.env.PATH ?? '',
  HOME: process.env.HOME ?? '',
  NODE_ENV: 'production',
  PORT: String(ports.app),
  HOST: '127.0.0.1',
  PUBLIC_URL: `http://127.0.0.1:${ports.app}`,
  DATABASE_PATH: dbPath,
  AUTH_EMAIL: login.email,
  AUTH_PASSWORD: login.password,
  CREDENTIALS_SECRET: secret(),
  TRACKING_SECRET: secret(),
  SUPPRESSION_SECRET: secret(),
  WEBHOOK_SECRET: webhookSecret,
  SIGN_IN_LINK_SECRET: secret(),
  USAGE_API_TOKEN: secret(),
  // Nothing in the stack checks anything outside it (ipify, blocklists).
  VERIFICATION_HEALTH_CHECKS: 'off',
  // GreenMail's STARTTLS certificate is its own; every TLS peer in the stack is a stand-in.
  NODE_TLS_REJECT_UNAUTHORIZED: '0',
  // Every outside service is the stand-in, DNS included.
  DNS_SERVERS: `127.0.0.1:${ports.dns}`,
  SOCIALFETCH_BASE_URL: hostUrl,
  SOCIALFETCH_API_KEY: 'stand-in',
  REACHER_URL: hostUrl,
  REACHER_SECRET: hostSecret,
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: String(ports.smtp),
  ...(mode === 'hosted'
    ? {
        // What magpie-cloud's tenantEnv gives a hosted copy (provision.ts), pointed at the stand-ins.
        PROSPECTING_MANAGED: 'on',
        SOCIALFETCH_BALANCE: 'hidden',
        SENDING_MANAGED: 'on',
        MANAGED_SENDING_URL: hostUrl,
        MANAGED_BILLING_URL: `${hostUrl}/v1/billing/test`,
        COPILOT_MANAGED: 'on',
        EMAIL_PROVIDER: 'smtp',
        SMTP_USER: 'test',
        SMTP_PASS: secret(),
      }
    : {
        // A self-hoster's own keys. The copilot's model APIs can't be stood in for (their addresses are
        // fixed), so it has none and stays off.
        SMTP_SENDER: 'Magpie Test <sender@magpie.test>',
        WEB_SEARCH_URL: `${hostUrl}/v1/scrape`,
        WEB_SEARCH_API_KEY: 'stand-in',
      }),
}
const app = spawn('bun', ['--no-env-file', 'serve.ts'], { cwd: root, env: appEnv, stdio: ['ignore', log('app'), log('app')] })
children.push(app)
app.on('exit', (code) => !stopping && fail(`the app stopped (${code}): see ${join(dir, 'app.log')}`))

await waitFor(`${hostUrl}/__health`, 'the stand-in host')
await waitFor(`http://127.0.0.1:${ports.mailWeb}/api/v1/info`, 'Mailpit')
await waitFor(`http://127.0.0.1:${ports.inboxApi}/api/configuration`, 'GreenMail')
await waitFor(`http://127.0.0.1:${ports.app}/login`, 'the app', 120_000)

const state: StackState = {
  appUrl: `http://127.0.0.1:${ports.app}`,
  hostUrl,
  login,
  mail: { smtpPort: ports.smtp, webUrl: `http://127.0.0.1:${ports.mailWeb}`, imapPort: ports.imap, inboxSmtpPort: ports.inboxSmtp, inboxApiPort: ports.inboxApi },
  mode,
  dir,
  dbPath,
  startedAt: new Date().toISOString(),
}
writeFileSync(join(dir, 'state.json'), JSON.stringify(state, null, 2), { mode: 0o600 })
// What the stand-in needs to act as the host towards the app (e.g. set its allowance).
writeFileSync(join(dir, 'app-tokens.json'), JSON.stringify({ usageApiToken: appEnv.USAGE_API_TOKEN, signInLinkSecret: appEnv.SIGN_IN_LINK_SECRET, webhookSecret }), { mode: 0o600 })

console.log(`[stack] ready (${mode}): ${state.appUrl}`)
console.log(`[stack] sign in with the login in ${join(dir, 'state.json')}; logs in ${dir}; Ctrl-C stops it`)
