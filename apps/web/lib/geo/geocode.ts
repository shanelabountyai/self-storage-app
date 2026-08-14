import zipcodes from 'zipcodes'

// PRD 01 FR-1.1 / US-101. Turns "78704", "Austin", or "Austin, TX" into a point
// to rank facilities against.
//
// Resolved against a bundled US dataset rather than Google or Mapbox. OQ-6 is
// still open and both options need a billed API key, so this follows D-4's
// precedent for undecided vendors: ship a real local implementation now, slot a
// driver in later. Geocoding needs no vendor at all — the data is public and
// changes about once a year — so OQ-6 narrows to maps and address autocomplete.
//
// Everything here is offline and deterministic, which is also why the tests can
// assert real coordinates instead of mocking a network call.

export type GeoPoint = { latitude: number; longitude: number }

export type GeocodeResult = GeoPoint & {
  /// What to echo back to the user, e.g. "Austin, TX 78704". US-101 asks the
  /// results page to show what was searched, and repeating raw input would show
  /// "  austin,tx  " back to someone who typed it.
  label: string
}

const ZIP = /^\d{5}$/
/// "Austin, TX" / "Austin TX" — a trailing two-letter state, comma optional.
const CITY_STATE = /^(.+?)[,\s]+([A-Za-z]{2})$/

/// US-101: "tolerant of casing/whitespace". Also collapses runs of internal
/// whitespace so "Austin,   TX" and "Austin, TX" are the same query.
function normalize(query: string): string {
  return query.trim().replace(/\s+/g, ' ')
}

function fromZip(zip: string): GeocodeResult | null {
  const record = zipcodes.lookup(zip)
  // The dataset returns undefined for unassigned zips like 00000. A syntactic
  // zip is not a real place, so this must stay a miss rather than a guess.
  if (!record) return null
  return {
    latitude: record.latitude,
    longitude: record.longitude,
    label: `${record.city}, ${record.state} ${record.zip}`,
  }
}

/// B-112. The city and state a zip code is in — the same bundled dataset D-14
/// settled on, asked a different question.
///
/// Checkout step 1 asked for city and state as free text next to the zip that
/// already determines both. `state` was a 2-character input, so a renter typing
/// "Texas" was rejected after submitting, which is a validation error the form
/// created for itself. Two fields removed from a step that §6.4 caps at seven
/// and that rendered fourteen.
///
/// Returns null for a zip the dataset does not know, which is a real case — new
/// and retired zips, and PO-box-only ranges — and the reason the step keeps a
/// way to type them by hand rather than treating the dataset as the authority
/// on where somebody lives.
export function localityForZip(zip: string): { city: string; state: string } | null {
  const record = zipcodes.lookup(zip.trim().slice(0, 5))
  if (!record?.city || !record.state) return null
  return { city: record.city, state: record.state }
}

/// city name (lowercased) -> its zip records, across every state.
/// Built once on first use; `zipcodes.lookupByName` needs a state, and a user
/// typing a bare "Tulsa" has not given one.
let cityIndex: Map<string, zipcodes.ZipCode[]> | null = null

function cityLookup(city: string): zipcodes.ZipCode[] {
  if (!cityIndex) {
    cityIndex = new Map()
    for (const record of Object.values(zipcodes.codes)) {
      // Guard: the dataset has a few malformed rows without a city.
      if (!record?.city) continue
      const key = record.city.toLowerCase()
      const bucket = cityIndex.get(key)
      if (bucket) bucket.push(record)
      else cityIndex.set(key, [record])
    }
  }
  return cityIndex.get(city.toLowerCase()) ?? []
}

/// A city is many zips, so its point is the mean of their centroids — closer to
/// the population centre than picking whichever zip happens to sort first.
function fromCity(city: string, state?: string): GeocodeResult | null {
  let matches = cityLookup(city)
  if (state) matches = matches.filter((m) => m.state === state)
  if (matches.length === 0) return null

  // "Springfield" exists in dozens of states. Rather than give up, resolve to
  // the most prominent one — most zip codes is a fair proxy for biggest — and
  // put the chosen state in the label so the user can see what was picked and
  // disambiguate by typing "Springfield, MA". A dead end here would be worse
  // than a correctable guess (US-101: "never a dead end").
  const byState = new Map<string, zipcodes.ZipCode[]>()
  for (const match of matches) {
    const bucket = byState.get(match.state)
    if (bucket) bucket.push(match)
    else byState.set(match.state, [match])
  }
  const chosen = [...byState.values()].sort((a, b) => b.length - a.length)[0]

  const latitude = chosen.reduce((sum, m) => sum + m.latitude, 0) / chosen.length
  const longitude = chosen.reduce((sum, m) => sum + m.longitude, 0) / chosen.length
  return { latitude, longitude, label: `${chosen[0].city}, ${chosen[0].state}` }
}

export function geocodeQuery(rawQuery: string): GeocodeResult | null {
  const query = normalize(rawQuery)
  if (query.length === 0) return null

  if (ZIP.test(query)) return fromZip(query)

  const cityState = CITY_STATE.exec(query)
  if (cityState) {
    const [, city, state] = cityState
    const hit = fromCity(city.trim(), state.toUpperCase())
    // "Paris, TX" is a city+state; "Paris, KY" with no facilities is still a
    // valid point. But a two-letter word that isn't a state (e.g. "Lake Ci")
    // should fall through to a plain city lookup rather than fail outright.
    if (hit) return hit
  }

  return fromCity(query)
}

const EARTH_RADIUS_MILES = 3958.8
const toRadians = (degrees: number) => (degrees * Math.PI) / 180

/// Great-circle distance in miles. Miles because every facility is in the US
/// and US-101's result cards are read by US renters.
///
/// Haversine rather than the cheaper equirectangular approximation: the cost
/// difference is irrelevant for a handful of facilities, and haversine is
/// correct at any separation instead of only over short ones.
export function distanceMiles(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.latitude - a.latitude)
  const dLon = toRadians(b.longitude - a.longitude)
  const lat1 = toRadians(a.latitude)
  const lat2 = toRadians(b.latitude)

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)))
}
