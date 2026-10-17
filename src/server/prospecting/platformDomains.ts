// Hosts a company's website or link can sit on that never hold its mail:
// social and link pages, and site builders' own domains (acme.wixsite.com,
// acme.myshopify.com), whose mail, if any, is the platform's. No imports, so
// the email finder and the data source can both use it.

export const NOT_A_MAIL_DOMAIN =
  /(^|\.)(linkedin\.com|linktr\.ee|facebook\.com|instagram\.com|x\.com|twitter\.com|youtube\.com|tiktok\.com|wixsite\.com|myshopify\.com|squarespace\.com|webflow\.io|github\.io|sites\.google\.com|business\.site|wordpress\.com|blogspot\.com|weebly\.com|godaddysites\.com|carrd\.co|notion\.site|framer\.website|netlify\.app|vercel\.app|bit\.ly|calendly\.com|beacons\.ai|linkin\.bio)$/

/** Whether a domain is one that can't be a company's own mail domain. */
export const isPlatformDomain = (domain: string | null | undefined) => Boolean(domain && NOT_A_MAIL_DOMAIN.test(domain.toLowerCase().replace(/^www\d?\./, '')))
