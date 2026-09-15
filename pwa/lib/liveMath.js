/** Live-check math. No geoNorway / polygons. */

export const LIVE_CHECK_TTL_MS = 15 * 60 * 1000;

function finiteNum(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

export function parseLiveCheckQuery(body) {
  const groups = [...new Set((body?.groups || []).map(String).filter(Boolean))];
  if (!groups.length) return { ok: false, error: "groups_required" };

  const cities = [...new Set((body?.cities || []).map(String).filter(Boolean))];
  const lat = finiteNum(body?.near?.lat);
  const lon = finiteNum(body?.near?.lon);
  const hasNear = lat != null && lon != null;
  if (!cities.length && !hasNear) return { ok: false, error: "scope_required" };

  const query = { groups, force: Boolean(body?.force) };
  if (cities.length) query.cities = cities;
  if (hasNear) {
    const km = finiteNum(body.near.km);
    query.near = { lat, lon, km: km != null && km > 0 ? km : 30 };
  }
  return { ok: true, query };
}

export function bboxFromRadiusKm(lat, lon, km) {
  const dLat = km / 111;
  const dLon = km / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return {
    minLat: lat - dLat,
    maxLat: lat + dLat,
    minLon: lon - dLon,
    maxLon: lon + dLon,
  };
}

export function cacheKey(query) {
  const cities = [...(query.cities || [])].sort().join(",");
  const groups = [...(query.groups || [])].sort().join(",");
  let near = "";
  if (query.near && Number.isFinite(query.near.lat) && Number.isFinite(query.near.lon)) {
    near = `${query.near.lat.toFixed(3)},${query.near.lon.toFixed(3)},${query.near.km ?? 30}`;
  }
  return `live:${cities}|${groups}|${near}`;
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Hermes / older WebViews may lack AbortSignal.timeout. */
export function abortTimeout(ms) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}
