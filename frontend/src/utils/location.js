const COORD_RE = /^(-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)$/
const cache = new Map()

export function isCoord(val) {
  return COORD_RE.test((val || '').trim())
}

function parseCoord(val) {
  const m = (val || '').trim().match(COORD_RE)
  if (!m) return null
  return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) }
}

export async function resolveLocation(val) {
  const text = (val || '').trim()
  if (!text) return ''
  const coord = parseCoord(text)
  if (!coord) return text
  const key = `${coord.lat},${coord.lng}`
  if (cache.has(key)) return cache.get(key)
  try {
    const res = await fetch(`/api/geocode/reverse?lat=${coord.lat}&lng=${coord.lng}`)
    if (!res.ok) throw new Error()
    const data = await res.json()
    const name = data.district || data.city || data.province || data.formatted_address || ''
    const result = name || ''
    cache.set(key, result)
    return result
  } catch {
    cache.set(key, '')
    return ''
  }
}
