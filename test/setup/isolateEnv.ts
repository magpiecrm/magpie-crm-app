// Unit tests never see this machine's own settings. `bun` and `bunx` load the
// repo's .env files into every process they start, so without this a test run
// here has the developer's real keys (a paid search, a real mail server) and
// their AUTH_EMAIL as a user, and a test that passes in CI (no .env there)
// fails here, or worse, reaches a real service. Each test sets what it needs.
import { readdirSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'

const root = fileURLToPath(new URL('../..', import.meta.url))

for (const file of readdirSync(root)) {
  if (!/^\.env(\..+)?$/.test(file) || file === '.env.example') continue
  for (const line of readFileSync(root + file, 'utf8').split('\n')) {
    const name = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1]
    if (name) delete process.env[name]
  }
}
