// When a company's LinkedIn website domain takes no email (jlr.com), its DNS
// often still names the domain its IT team runs: the SOA record's admin
// contact is `dnsadmin.jaguarlandrover.com`, and jaguarlandrover.com has a
// mail server. That's offered to the user as a one-click suggestion, never
// applied automatically, because the contact usually belongs to whoever hosts
// the DNS instead (Cloudflare, GoDaddy, Neustar…). DNS lookups only; no
// website is fetched.

// DNS hosts, registrars and platforms whose addresses show up as SOA
// contacts for their customers' domains. Matched as a suffix.
const DNS_HOSTS = [
  'cloudflare.com', 'amazon.com', 'amazonaws.com', 'awsdns.com', 'google.com', 'googledomains.com',
  'microsoft.com', 'azure-dns.com', 'azure-dns.net', 'akamai.com', 'akam.net', 'nsone.net', 'ultradns.com',
  'ultradns.net', 'neustar', 'neustar.biz', 'dnsmadeeasy.com', 'domaincontrol.com', 'godaddy.com', 'jomax.net',
  'secureserver.net', 'registrar-servers.com', 'namecheap.com', 'gandi.net', 'ovh.net', 'ovh.com', 'hetzner.com',
  'hetzner.de', 'ionos.com', 'ionos.co.uk', 'ui-dns.com', '1and1.com', '123-reg.co.uk', 'name.com', 'easydns.com',
  'dynect.net', 'dyn.com', 'markmonitor.com', 'cscdns.net', 'cscglobal.com', 'digitalocean.com', 'linode.com',
  'vultr.com', 'netlify.com', 'vercel.com', 'wixdns.net', 'wix.com', 'squarespace.com', 'shopify.com',
  'hostgator.com', 'bluehost.com', 'siteground.com', 'dreamhost.com', 'rackspace.com', 'heartinternet.uk',
  'fasthosts.co.uk', 'tsohost.com', 'krystal.uk', 'eurodns.com', 'nic.uk', 'verisign.com', 'afilias.info',
  'identity.digital', 'dnsimple.com', 'hover.com', 'tucows.com', 'enom.com', 'networksolutions.com', 'web.com',
  'register.com', 'porkbun.com', 'cloudns.net', 'he.net', 'zoneedit.com', 'no-ip.com', 'one.com', 'strato.de',
  'hosteurope.de', 'inwx.de', 'transip.nl', 'loopia.se', 'names.co.uk', 'lcn.com', 'easyspace.com', 'ukfast.net',
  'mythic-beasts.com', 'memset.com', 'bytemark.co.uk', 'gname.com', 'alidns.com', 'hichina.com', 'yandex.net',
]

const isDnsHost = (domain: string) => DNS_HOSTS.some((h) => domain === h || domain.endsWith(`.${h}`))

/** Registrable-ish domain of an SOA admin contact ("dnsadmin.jaguarlandrover.com" -> "jaguarlandrover.com"). */
export function domainFromSoaContact(hostmaster: string): string | null {
  const labels = hostmaster.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean)
  if (labels.length < 3) return null
  // The first label is the mailbox ("dnsadmin"). Keep a UK-style second
  // level if present ("hostmaster.acme.co.uk" -> "acme.co.uk").
  const rest = labels.slice(1)
  const secondLevel = rest.length >= 3 && /^(co|org|ac|gov|ltd|plc|net|com)$/.test(rest[rest.length - 2])
  const domain = rest.slice(secondLevel ? -3 : -2).join('.')
  return domain.includes('.') ? domain : null
}

export interface HintDeps {
  resolveSoaContact(domain: string): Promise<string | null>
  resolveMx(domain: string): Promise<string[]>
}

/**
 * A different domain, named by `domain`'s DNS admin contact, that does take
 * email. Null when there's nothing trustworthy to suggest.
 */
export async function suggestMailDomain(domain: string, deps: HintDeps): Promise<string | null> {
  let contact: string | null
  try {
    contact = await deps.resolveSoaContact(domain)
  } catch {
    return null
  }
  const candidate = contact ? domainFromSoaContact(contact) : null
  if (!candidate || isDnsHost(candidate)) return null
  // Same organisation's own domain (or a parent of it): nothing new.
  if (candidate === domain || domain.endsWith(`.${candidate}`)) return null
  try {
    return (await deps.resolveMx(candidate)).length > 0 ? candidate : null
  } catch {
    return null
  }
}
