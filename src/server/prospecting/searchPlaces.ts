// The cities a verified people search (verifiedPeopleSource.ts) works through
// inside a country. One query per job title and country only reaches about 40
// profiles, the same ones each time, so a search also asks about a few cities,
// and the next asks about the next few. Measured on hq's own filters
// (2026-10-31): 11 of 12 people from six cities were new to the country's own
// search, at about one person per search. It finds people where a filter has
// plenty of them, not where few exist: that's still up to who passes.
//
// A search with no country works through the world's business cities the same
// way: on its own it was a single query per job title, 3 to 6 searches against
// a country's 30 to 60 (hq, 2026-11), and found nobody for a rare title.
//
// Largest business cities first. A country not listed searches as a whole.

const CITIES: Record<string, string[]> = {
  'United States': [
    'New York', 'Los Angeles', 'Chicago', 'San Francisco', 'Austin', 'Miami', 'Boston', 'Seattle',
    'Atlanta', 'Dallas', 'Denver', 'Washington DC', 'Houston', 'San Diego', 'Philadelphia', 'Phoenix',
    'Minneapolis', 'Nashville', 'Portland', 'Charlotte', 'Salt Lake City', 'Detroit', 'Tampa', 'Las Vegas',
  ],
  'United Kingdom': ['London', 'Manchester', 'Birmingham', 'Leeds', 'Bristol', 'Edinburgh', 'Glasgow', 'Liverpool', 'Nottingham', 'Sheffield', 'Cardiff', 'Newcastle'],
  Canada: ['Toronto', 'Vancouver', 'Montreal', 'Calgary', 'Ottawa', 'Edmonton'],
  Australia: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide'],
  Ireland: ['Dublin', 'Cork', 'Galway'],
  Germany: ['Berlin', 'Munich', 'Hamburg', 'Frankfurt', 'Cologne', 'Stuttgart'],
  France: ['Paris', 'Lyon', 'Marseille', 'Toulouse'],
  Netherlands: ['Amsterdam', 'Rotterdam', 'Utrecht', 'The Hague'],
  Spain: ['Madrid', 'Barcelona', 'Valencia'],
  Italy: ['Milan', 'Rome', 'Turin'],
  'New Zealand': ['Auckland', 'Wellington', 'Christchurch'],
  Belgium: ['Brussels', 'Antwerp', 'Ghent'],
  Sweden: ['Stockholm', 'Gothenburg', 'Malmö'],
  Denmark: ['Copenhagen', 'Aarhus'],
  Norway: ['Oslo', 'Bergen'],
  Switzerland: ['Zurich', 'Geneva', 'Basel'],
  Poland: ['Warsaw', 'Kraków', 'Wrocław'],
  Israel: ['Tel Aviv', 'Jerusalem', 'Haifa'],
  'United Arab Emirates': ['Dubai', 'Abu Dhabi'],
  India: ['Bangalore', 'Mumbai', 'Delhi', 'Hyderabad', 'Pune', 'Chennai'],
  'South Africa': ['Johannesburg', 'Cape Town', 'Durban'],
  Brazil: ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte'],
}

/** For a search with no country: each batch of six spans several countries. */
const WORLD = [
  'London', 'New York', 'Toronto', 'Sydney', 'Singapore', 'Dubai',
  'San Francisco', 'Berlin', 'Amsterdam', 'Dublin', 'Bangalore', 'Melbourne',
  'Los Angeles', 'Paris', 'Manchester', 'Stockholm', 'Tel Aviv', 'Vancouver',
  'Chicago', 'Madrid', 'Zurich', 'Mumbai', 'Copenhagen', 'Auckland',
  'Boston', 'Munich', 'Milan', 'Johannesburg', 'São Paulo', 'Brussels',
]

/** Cities one search takes, shared between its job titles: each title searches each city. */
const CITIES_PER_SEARCH = 6
const MIN_CITIES = 2
const CURSOR = /^places:(\d+)$/

export interface PlacesPlan {
  places: string[]
  /** A later search: the country's own search has been run, so only the cities are. */
  placesOnly: boolean
  /** Where the next search takes up, or null where this one reaches the last city. */
  next: string | null
}

/** The cities this search takes, from `cursor` (a page's own, or where the last search stopped). */
export function placesFor(country: string | null | undefined, titles: number, cursor: string | null | undefined): PlacesPlan {
  const cities = country?.trim() ? (CITIES[country.trim()] ?? []) : WORLD
  if (!cities.length) return { places: [], placesOnly: false, next: null }
  const from = Number(cursor?.match(CURSOR)?.[1] ?? 0)
  const start = from < cities.length ? from : 0
  const end = start + Math.max(MIN_CITIES, Math.ceil(CITIES_PER_SEARCH / Math.max(1, titles)))
  return { places: cities.slice(start, end), placesOnly: start > 0, next: end < cities.length ? `places:${end}` : null }
}
