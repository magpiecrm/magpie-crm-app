// Country -> LinkedIn geo entity id, for SocialFetch's `geoEntityId` filter.
//
// Only the United Kingdom id was checked against the live API (2026-09-25:
// every result came back in the UK). The rest are LinkedIn's standard country
// ids; searchPeople warns if results come back mostly from another country, so
// a wrong id here shows up rather than silently returning the wrong people.

const COUNTRY_GEO_IDS: Record<string, string> = {
  'United Kingdom': '101165590',
  'United States': '103644278',
  Canada: '101174742',
  Ireland: '104738515',
  Australia: '101452733',
  'New Zealand': '105490917',
  Germany: '101282230',
  France: '105015875',
  Netherlands: '102890719',
  Belgium: '100565514',
  Spain: '105646813',
  Italy: '103350119',
  Sweden: '105117694',
  Denmark: '104514075',
  Norway: '103819153',
  Switzerland: '106693272',
  Poland: '105072130',
  Israel: '101620260',
  'United Arab Emirates': '104305776',
  Singapore: '102454443',
  India: '102713980',
  'South Africa': '104035573',
  Brazil: '106057199',
}

export const SUPPORTED_COUNTRIES = Object.keys(COUNTRY_GEO_IDS)

// Other names people type, or that LinkedIn location labels end with.
const ALIASES: Record<string, string> = {
  uk: 'United Kingdom',
  'great britain': 'United Kingdom',
  britain: 'United Kingdom',
  england: 'United Kingdom',
  scotland: 'United Kingdom',
  wales: 'United Kingdom',
  'northern ireland': 'United Kingdom',
  'greater london': 'United Kingdom',
  london: 'United Kingdom',
  'london area': 'United Kingdom',
  us: 'United States',
  usa: 'United States',
  america: 'United States',
  'united states of america': 'United States',
  uae: 'United Arab Emirates',
  holland: 'Netherlands',
  'the netherlands': 'Netherlands',
}

/** Canonical country name for free text, or null if it isn't a known country. */
export function canonicalCountry(value: string | null | undefined): string | null {
  const key = (value ?? '').toLowerCase().trim()
  if (!key) return null
  if (ALIASES[key]) return ALIASES[key]
  return SUPPORTED_COUNTRIES.find((c) => c.toLowerCase() === key) ?? null
}

export function geoIdForCountry(value: string | null | undefined): string | null {
  const country = canonicalCountry(value)
  return country ? COUNTRY_GEO_IDS[country] : null
}
