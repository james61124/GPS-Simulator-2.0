// app/lib/geo.ts
export type LatLng = { lat: number; lng: number }

export function parseLatLng(text: string): LatLng | null {
  const s = text.trim()
  const cleaned = s.replace(/[()]/g, " ").replace(/\s+/g, " ").trim()
  const parts = cleaned.split(/[, ]+/).filter(Boolean)
  if (parts.length !== 2) return null
  const lat = Number(parts[0])
  const lng = Number(parts[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

export async function geocodeAddress(addr: string): Promise<LatLng | null> {
  const q = addr.trim()
  if (!q) return null
  const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(q)
  const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" })
  if (!res.ok) return null
  const data = (await res.json()) as Array<{ lat: string; lon: string }>
  const first = data?.[0]
  if (!first) return null
  const lat = Number(first.lat)
  const lng = Number(first.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

export async function resolveTextToPoint(text: string): Promise<LatLng | null> {
  let p = parseLatLng(text)
  if (!p) p = await geocodeAddress(text)
  return p
}