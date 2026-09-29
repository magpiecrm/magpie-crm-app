import { describe, expect, it } from 'vitest'
import { BillingFailure, getBilling, hostBilling, isPaymentPage, paymentPage } from './managedBilling'

const deps = (respond: (url: string, init: RequestInit) => Response | Promise<Response>, seen: Array<{ url: string; init: RequestInit }> = []) => ({
  base: 'https://services.example/v1/billing/acme',
  token: 'ut_secret',
  fetch: async (url: string, init: RequestInit) => {
    seen.push({ url, init })
    return respond(url, init)
  },
})

describe("the host's billing API", () => {
  it('sends the usage token and an idempotency key, never in the browser', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = []
    await hostBilling('POST', '/plan', { plan: { prospects: 1 } }, { idempotencyKey: 'k1' }, deps(() => Response.json({ changed: 'up' }), seen))
    expect(seen[0].url).toBe('https://services.example/v1/billing/acme/plan')
    expect(seen[0].init.headers).toMatchObject({ Authorization: 'Bearer ut_secret', 'Idempotency-Key': 'k1', 'Content-Type': 'application/json' })
  })

  it("turns the host's refusals into words to show", async () => {
    const refuse = (status: number, error: string, message = 'x') => deps(() => Response.json({ error, message }, { status }))
    await expect(hostBilling('POST', '/plan', {}, {}, refuse(402, 'card_declined'))).rejects.toThrow(/card was declined, so nothing changed/)
    await expect(hostBilling('POST', '/plan', {}, {}, refuse(409, 'cancel_pending'))).rejects.toThrow(/Keep my plan first/)
    await expect(hostBilling('POST', '/plan', {}, {}, refuse(400, 'invalid_plan', 'The minimum is £10 a month.'))).rejects.toThrow('The minimum is £10 a month.')
    await expect(hostBilling('GET', '', undefined, {}, refuse(503, 'unavailable'))).rejects.toThrow(/isn't available right now/)
    await expect(hostBilling('GET', '', undefined, {}, deps(() => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' }))))).rejects.toThrow(/couldn't confirm the change/)
  })

  it('says when billing isn’t set up, and treats a host that stopped billing as no billing', async () => {
    await expect(hostBilling('GET', '', undefined, {}, { base: '', token: '' })).rejects.toBeInstanceOf(BillingFailure)
    expect(await getBilling(deps(() => Response.json({ managed: false }, { status: 404 })))).toBeNull()
    expect(await getBilling(deps(() => Response.json({ managed: true, status: 'active' })))).toMatchObject({ status: 'active' })
  })

  it("only hands the browser the payment provider's own pages", () => {
    expect(isPaymentPage('https://checkout.stripe.com/c/pay/cs_1')).toBe(true)
    expect(isPaymentPage('https://billing.stripe.com/p/session/x')).toBe(true)
    expect(isPaymentPage('https://evil.example/checkout.stripe.com')).toBe(false)
    expect(isPaymentPage('http://checkout.stripe.com/x')).toBe(false)
    expect(isPaymentPage('javascript:alert(1)')).toBe(false)
    expect(() => paymentPage({ url: 'https://evil.example' })).toThrow(BillingFailure)
  })
})
