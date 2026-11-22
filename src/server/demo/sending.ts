// The demo's sending domain, verified, as a customer's looks once its DNS
// records are in place: the same two records the host gives every domain
// (magpie-cloud mtaDomains.ts), so Settings → Sending and Senders show it set
// up. The DKIM key is made up and nothing is ever published or sent: a demo
// copy has no login to the mail server, and its sendMail sends nothing.

import type { SendingDomain } from '../sendingDomains'
import { WORKSPACE } from './content'

const DAY = 86_400_000

/** Base64 of no real key, the length of a 2048-bit one's. */
function madeUpKey(): string {
  let state = 0x2f6a9c1d
  const bytes = Buffer.alloc(294)
  for (let i = 0; i < bytes.length; i++) {
    state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0
    bytes[i] = state >>> 24
  }
  // A real key's DER header, so it reads like one.
  return 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA' + bytes.toString('base64').slice(44, 392)
}

export function demoSendingDomain(now: Date): SendingDomain {
  const domain = WORKSPACE.domain
  return {
    domain,
    records: [
      {
        type: 'TXT',
        name: `mg4c1e7a02._domainkey.${domain}`,
        value: `v=DKIM1; k=rsa; p=${madeUpKey()}`,
        purpose: 'Signs your email (DKIM) and shows you may send from the domain',
      },
      {
        type: 'TXT',
        name: `_dmarc.${domain}`,
        value: 'v=DMARC1; p=none;',
        purpose: 'Tells inboxes what to do with mail that fails checks; skip it if you have one already',
        optional: true,
      },
    ],
    ready: true,
    // Added before the first campaign went out, checked this morning.
    addedAt: new Date(now.getTime() - 75 * DAY).toISOString(),
    checkedAt: new Date(now.getTime() - 3 * 3_600_000).toISOString(),
  }
}
