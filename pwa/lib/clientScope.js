/** Browser-safe geo from baked kommuner.json. No 37 MB polygons. */
import { abortTimeout } from "./liveMath.js";

function canonicalId(doc, row) {
  const alias = Object.entries(doc.aliases || {}).find(([, slug]) => slug === row.id);
  return alias ? alias[0] : row.id;
}

export function citiesFromKommuner(doc) {
  const map = {};
  for (const row of doc.kommuner || []) {
    const id = canonicalId(doc, row);
    const city = {
      id,
      slug: row.id,
      label: row.name,
      bbox: row.bbox,
      center: row.center,
      kommuneNr: [row.nr],
      fylkeNr: row.fylkeNr,
      fylke: row.fylke,
      area: row.area,
    };
    map[id] = city;
    if (city.slug !== id) map[city.slug] = city;
  }
  return map;
}

export function uniqueCitiesFrom(doc) {
  const map = citiesFromKommuner(doc);
  return [...new Map(Object.values(map).map((c) => [c.id, c])).values()];
}

export function expandCitySelectionFrom(doc, ids) {
  const map = citiesFromKommuner(doc);
  const fylker = doc.fylker || [];
  const out = new Set();
  for (const raw of ids || []) {
    const id = String(raw || "").toLowerCase().trim();
    if (!id) continue;
    if (id.startsWith("fylke-")) {
      const f = fylker.find((x) => x.id === id || x.nr === id.slice(6));
      if (f) {
        for (const slug of f.kommuneIds || []) {
          const c = map[slug];
          out.add(c?.id || slug);
        }
      }
      continue;
    }
    const c = map[id];
    if (c) out.add(c.id);
  }
  return [...out];
}

export function bboxOverlapsNear(bbox, near) {
  if (!bbox || !near) return false;
  const km = near.km > 0 ? near.km : 30;
  const dLat = km / 111;
  const dLon = km / (111 * Math.max(0.2, Math.cos((near.lat * Math.PI) / 180)));
  const minLat = near.lat - dLat;
  const maxLat = near.lat + dLat;
  const minLon = near.lon - dLon;
  const maxLon = near.lon + dLon;
  return !(bbox.east < minLon || bbox.west > maxLon || bbox.north < minLat || bbox.south > maxLat);
}

export function citiesOverlappingNearBbox(doc, near) {
  return uniqueCitiesFrom(doc)
    .filter((c) => bboxOverlapsNear(c.bbox, near))
    .map((c) => c.id);
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polygonsOf(omrade) {
  const geom = omrade?.type === "Feature" ? omrade.geometry : omrade;
  if (!geom?.coordinates) return [];
  if (geom.type === "Polygon") return [geom.coordinates];
  if (geom.type === "MultiPolygon") return geom.coordinates;
  const first = geom.coordinates[0]?.[0]?.[0];
  if (Array.isArray(first) && typeof first[0] === "number") return geom.coordinates;
  if (typeof first === "number") return [geom.coordinates];
  return geom.coordinates;
}

export function pointInOmrade(lon, lat, omrade) {
  if (!omrade) return false;
  for (const poly of polygonsOf(omrade)) {
    const outer = poly[0];
    if (!outer || !pointInRing(lon, lat, outer)) continue;
    if (poly.slice(1).some((hole) => pointInRing(lon, lat, hole))) continue;
    return true;
  }
  return false;
}

export function catalogFromKommuner(doc, activityCatalog) {
  const map = citiesFromKommuner(doc);
  return {
    groups: activityCatalog?.groups || [],
    fylker: (doc.fylker || []).map((f) => ({
      id: f.id,
      nr: f.nr,
      name: f.name,
      bbox: f.bbox,
      kommuner: (f.kommuneIds || []).map((slug) => {
        const c = map[slug];
        const id = c?.id || slug;
        return {
          id,
          label: c?.label || slug,
          fylke: c?.fylke,
          bbox: c?.bbox || null,
          claimed: false,
        };
      }),
    })),
    cities: uniqueCitiesFrom(doc).map((c) => ({
      id: c.id,
      label: c.label,
      fylke: c.fylke,
      fylkeId: `fylke-${c.fylkeNr}`,
      bbox: c.bbox,
      claimed: false,
    })),
  };
}

export async function fetchKommuneOmrade(kommuneNr, fetchFn = fetch) {
  const nr = String(kommuneNr || "").padStart(4, "0");
  const inBrowser = typeof window !== "undefined" && typeof document !== "undefined";
  const res = await fetchFn(`https://ws.geonorge.no/kommuneinfo/v1/kommuner/${nr}/omrade`, {
    headers: inBrowser
      ? { Accept: "application/json" }
      : { Accept: "application/json", "User-Agent": "NartNa/0.1 (device live-check)" },
    signal: abortTimeout(20_000),
  });
  if (!res.ok) throw new Error(`omrade ${nr} ${res.status}`);
  const json = await res.json();
  return json.omrade || json;
}
