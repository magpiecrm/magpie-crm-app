// ST1, ST2 and M5 (test/JOURNEYS.md): sending set up as a hosted customer does it.
import { expect, test } from './fixtures'
import { SENDER, ensureSender } from './helpers'
import { waitForSent } from '../stack/mail'

test('a sending domain turns ready, a sender is added and its inbox connects', async ({ page, problems, host }) => {
  await ensureSender(page)
  // The domain was registered with the host's mail server, as a hosted copy does.
  expect((await host.log(`/v1/mta/domains/${SENDER.domain}`)).length).toBeGreaterThan(0)
  expect(problems()).toEqual([])
})

test('a test email reaches only the address given', async ({ page, problems }) => {
  await ensureSender(page)
  const to = `test-${Date.now()}@owner.test`
  await page.goto('/settings?tab=sending')
  const main = page.getByRole('main')
  await main.getByPlaceholder('you@example.com').fill(to)
  await main.getByRole('button', { name: 'Send a test' }).click()
  const [mail] = await waitForSent(to, { timeoutMs: 20_000 })
  expect(mail.from).toContain(`@${SENDER.domain}`)
  expect(mail.to).toEqual([to])
  expect(problems()).toEqual([])
})
