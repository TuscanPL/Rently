// Google's encoded polyline format, which MOTIS/Transitous uses for leg shapes.
// `precision` is the number of decimals (5 in Google's original, 6–7 in MOTIS).

export type LatLngTuple = [number, number]

export function decodePolyline(encoded: string, precision = 5): LatLngTuple[] {
  const factor = 10 ** precision
  const points: LatLngTuple[] = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < encoded.length) {
    const deltas: number[] = []
    for (let coord = 0; coord < 2; coord++) {
      let result = 0
      let shift = 0
      let byte: number
      do {
        if (index >= encoded.length) return points
        byte = encoded.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      deltas.push(result & 1 ? ~(result >> 1) : result >> 1)
    }
    lat += deltas[0]!
    lng += deltas[1]!
    points.push([lat / factor, lng / factor])
  }
  return points
}

export function encodePolyline(points: LatLngTuple[], precision = 5): string {
  const factor = 10 ** precision
  let out = ''
  let prevLat = 0
  let prevLng = 0
  const encode = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
      v >>= 5
    }
    out += String.fromCharCode(v + 63)
  }
  for (const [lat, lng] of points) {
    const iLat = Math.round(lat * factor)
    const iLng = Math.round(lng * factor)
    encode(iLat - prevLat)
    encode(iLng - prevLng)
    prevLat = iLat
    prevLng = iLng
  }
  return out
}
