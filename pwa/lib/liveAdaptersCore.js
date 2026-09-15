/**
 * Thin live adapters. Query in, { places, events, sourceOk } out.
 * Browser-safe: no geoNorway, no node:crypto.
 */
import { abortTimeout, bboxFromRadiusKm, haversineKm } from "./liveMath.js";
import { isReligionItem } from "./religion.js";
import { osloLocalToIso } from "./osloWallClock.js";
import { pointInOmrade } from "./clientScope.js";

const UA = "NartNa/0.1 (live-check; query-scoped; no Facebook)";
const CHARLIE = { lat: 59.14067, lon: 9.65521, name: "Filmsentret Charlie" };
const IBSEN = { lat: 59.2072, lon: 9.6108, name: "Ibsenhuset" };
const IN_BROWSER = typeof window !== "undefined" && typeof document !== "undefined";

function requestHeaders(extra = {}) {
  const headers = { Accept: extra.accept || "application/json" };
  if (extra.contentType) headers["Content-Type"] = extra.contentType;
  if (!IN_BROWSER) {
    headers["User-Agent"] = extra.ua || UA;
    if (extra.referer) headers.Referer = extra.referer;
  }
  return headers;
}

let _cityForPoint = () => null;
let _uniqueCities = () => [];

export function bindLiveGeo({ cityForPoint, uniqueCities } = {}) {
  if (typeof cityForPoint === "function") _cityForPoint = cityForPoint;
  if (typeof uniqueCities === "function") _uniqueCities = uniqueCities;
}

function resolveCityForPoint(lat, lon, query) {
  if (typeof query?.cityForPoint === "function") return query.cityForPoint(lat, lon);
  return _cityForPoint(lat, lon);
}

function resolveUniqueCities(query) {
  if (typeof query?.uniqueCities === "function") return query.uniqueCities();
  return _uniqueCities();
}

function cityForPoint(lat, lon, query) {
  return resolveCityForPoint(lat, lon, query);
}

function uniqueCities(query) {
  return resolveUniqueCities(query);
}

function pointInBbox(lat, lon, bbox) {
  if (!bbox) return false;
  return lat >= bbox.south && lat <= bbox.north && lon >= bbox.west && lon <= bbox.east;
}

export function keepPoint(lat, lon, query) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const placeCities = query.filterCities || (!query.near ? query.cities : []) || [];
  let inPlace = false;
  if (placeCities.length) {
    const id = cityForPoint(lat, lon, query);
    if (id && placeCities.includes(id)) inPlace = true;
    else if (query.polygons) {
      for (const cid of placeCities) {
        if (pointInOmrade(lon, lat, query.polygons[cid])) {
          inPlace = true;
          break;
        }
      }
    }
    if (!inPlace) {
      const rows = uniqueCities(query);
      for (const cid of placeCities) {
        const row = rows.find((c) => c.id === cid);
        if (pointInBbox(lat, lon, row?.bbox)) {
          inPlace = true;
          break;
        }
      }
    }
  }
  let inNear = false;
  if (query.near) {
    inNear = haversineKm(query.near.lat, query.near.lon, lat, lon) <= (query.near.km || 30);
  }
  if (query.near && placeCities.length) return inPlace || inNear;
  if (query.near) return inNear;
  if (placeCities.length) return inPlace;
  const cities = query.cities || [];
  if (!cities.length) return true;
  const id = cityForPoint(lat, lon, query);
  return Boolean(id && cities.includes(id));
}

function queryBbox(query) {
  if (query.near) {
    const b = bboxFromRadiusKm(query.near.lat, query.near.lon, query.near.km || 30);
    return { south: b.minLat, west: b.minLon, north: b.maxLat, east: b.maxLon };
  }
  const boxes = uniqueCities(query).filter((c) => (query.cities || []).includes(c.id));
  if (!boxes.length) return null;
  return {
    south: Math.min(...boxes.map((c) => c.bbox.south)),
    west: Math.min(...boxes.map((c) => c.bbox.west)),
    north: Math.max(...boxes.map((c) => c.bbox.north)),
    east: Math.max(...boxes.map((c) => c.bbox.east)),
  };
}

function hid(sourceId, kind, externalId) {
  const s = `${sourceId}:${externalId}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `${kind}-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

async function fetchJson(url, extra = {}) {
  const res = await fetch(url, {
    headers: requestHeaders(extra),
    signal: abortTimeout(extra.timeoutMs || 20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const OSM_FOR = {
  playground: '["leisure"="playground"]',
  park: '["leisure"="park"]',
  cinema: '["amenity"="cinema"]',
  theatre: '["amenity"="theatre"]',
  museum: '["tourism"="museum"]',
  library: '["amenity"="library"]',
  cafe: '["amenity"="cafe"]',
  nightlife: '["amenity"~"bar|pub|nightclub"]',
  beach: '["natural"="beach"]',
  swim_pool: '["leisure"="swimming_pool"]',
  skateboard: '["leisure"="skatepark"]',
  ice_rink: '["leisure"="ice_rink"]',
  football: '["sport"="soccer"]',
  basketball: '["sport"="basketball"]',
  tennis: '["sport"="tennis"]',
  volleyball: '["sport"="volleyball"]',
  handball: '["sport"="handball"]',
  climbing: '["sport"="climbing"]',
  golf: '["leisure"="golf_course"]',
  gym: '["leisure"="fitness_centre"]',
  bowling: '["leisure"="bowling_alley"]',
  restaurant: '["amenity"="restaurant"]',
  picnic: '["tourism"="picnic_site"]',
  camping: '["tourism"="camp_site"]',
};

export function overpassPatternsFor(activityIds) {
  const patterns = new Set();
  for (const id of activityIds || []) {
    if (OSM_FOR[id]) patterns.add(OSM_FOR[id]);
  }
  return [...patterns];
}

function overpassQuery(activityIds, bbox) {
  const patterns = overpassPatternsFor(activityIds);
  if (!patterns.length) return null;
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const blocks = patterns.flatMap((p) => [`  node${p}(${b});`, `  way${p}(${b});`]).join("\n");
  return `[out:json][timeout:20];\n(\n${blocks}\n);\nout center tags;`;
}

export function wpStartsAt(item) {
  const raw = item?.meta?.start || item?.acf?.start || item?.acf?.start_date || item?.event_date;
  if (!raw) return null;
  if (raw === item.date || raw === item.modified) return null;
  const t = new Date(raw);
  if (Number.isNaN(t.getTime())) return null;
  return t.toISOString();
}

/** OSM census / curated venue table. Skip alias if no coords. */
const ODEON_VENUES = {
  SK: { lat: 59.2050236, lon: 9.6045587, page: "https://www.odeonkino.no/skien/kino/odeon-skien/", name: "ODEON Skien" },
  OS: { lat: 59.9476828, lon: 10.7725463, page: "https://www.odeonkino.no/oslo/", name: "ODEON Oslo" },
  SN: { lat: 59.8890706, lon: 10.5223144, page: "https://www.odeonkino.no/sandvika/", name: "ODEON Sandvika" },
  SA: { lat: 58.8510568, lon: 5.7380168, page: "https://www.odeonkino.no/sandnes/", name: "ODEON Sandnes" },
  ST: { lat: 58.9712442, lon: 5.7330414, page: "https://www.odeonkino.no/stavanger/", name: "ODEON Stavanger" },
  MO: { lat: 59.4384403, lon: 10.6675407, page: "https://www.odeonkino.no/moss/", name: "ODEON Moss" },
  AL: { lat: 62.4658991, lon: 6.3527316, page: "https://www.odeonkino.no/alesund/", name: "ODEON Ålesund" },
};

export function odeonEventFromShow(show, movies, venue, alias) {
  if (!show?.utc || !venue || !Number.isFinite(venue.lat) || !Number.isFinite(venue.lon)) return null;
  const movie = movies.get(show.mId) || movies.get(show.mvId);
  const title = String(movie?.title || "").trim();
  if (!title) return null;
  const startsAt = new Date(show.utc).toISOString();
  if (Number.isNaN(new Date(startsAt).getTime())) return null;
  const slug = movie.slug || "";
  const url = slug ? `https://www.odeonkino.no/film/${slug}/` : venue.page || "https://www.odeonkino.no/";
  return {
    id: hid("odeon-kino", "event", `${alias}:${show.utc}:${title}`),
    title,
    startsAt,
    lat: venue.lat,
    lon: venue.lon,
    sourceUrl: url,
    deepLink: url,
    sourceId: "odeon-kino",
    venue: show.ct || venue.name || "ODEON",
  };
}

async function odeonMovieMap() {
  const movies = new Map();
  const endpoints = [
    "https://services.cinema-api.com/movie/scheduled/no/1/1024/false",
    "https://services.cinema-api.com/movie/upcoming/no/1/1024/false",
  ];
  const bodies = await Promise.all(
    endpoints.map((url) => fetchJson(url, { referer: "https://www.odeonkino.no/" }).catch(() => null)),
  );
  for (const data of bodies) {
    for (const movie of data?.items || []) {
      if (!movie?.title) continue;
      if (movie.ncgId) movies.set(movie.ncgId, movie);
      for (const ver of movie.versions || []) {
        if (ver.ncgId) movies.set(ver.ncgId, movie);
      }
    }
  }
  return movies;
}

async function overpass({ row, query }) {
  const bbox = queryBbox(query);
  if (!bbox) return { places: [], events: [], sourceOk: false };
  const q = overpassQuery(row.activityIds, bbox);
  if (!q) return { places: [], events: [], sourceOk: true };
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];
  let elements = null;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: requestHeaders({ contentType: "application/x-www-form-urlencoded" }),
        body: `data=${encodeURIComponent(q)}`,
        signal: abortTimeout(45_000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      elements = json.elements || [];
      break;
    } catch {
      /* next */
    }
  }
  if (!elements) return { places: [], events: [], sourceOk: false };
  const places = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!keepPoint(lat, lon, query)) continue;
    const name = el.tags?.name || el.tags?.["name:nb"];
    if (!name) continue;
    const place = {
      id: hid("osm-overpass", "place", String(el.id)),
      name,
      lat,
      lon,
      categories: [],
      sourceId: "osm-overpass",
      sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    };
    if (isReligionItem(place)) continue;
    places.push(place);
  }
  return { places, events: [], sourceOk: true };
}

function cityLabels(query) {
  const want = new Set(query.cities || []);
  const labels = uniqueCities(query)
    .filter((c) => want.has(c.id))
    .map((c) => c.label);
  return [...new Set(labels)].slice(0, 8);
}

async function hoopla({ query }) {
  const names = cityLabels(query);
  if (!names.length) return { places: [], events: [], sourceOk: true };
  const events = [];
  const places = [];
  let ok = false;
  for (const name of names) {
    try {
      const body = await fetchJson(
        `https://api.hoopla.no/api/public/v3.1/events?c=${encodeURIComponent(name)}`,
      );
      ok = true;
      const rows = Array.isArray(body.events) ? body.events : [];
      for (const row of rows) {
        const title = String(row.event_name || "").trim();
        const startsAt = row.start ? new Date(row.start).toISOString() : null;
        const lat = Number(row.location?.coordinates?.latitude);
        const lon = Number(row.location?.coordinates?.longitude);
        if (!title || !startsAt || Number.isNaN(new Date(startsAt).getTime())) continue;
        if (!keepPoint(lat, lon, query)) continue;
        const url = row.event_sales_page_url;
        if (!url) continue;
        const ev = {
          id: hid("hoopla", "event", String(row.event_id)),
          title,
          startsAt,
          lat,
          lon,
          sourceUrl: url,
          deepLink: url,
          sourceId: "hoopla",
          venue: row.location?.place || null,
        };
        if (isReligionItem(ev)) continue;
        events.push(ev);
        places.push({
          id: hid("hoopla", "place", `${lat},${lon}`),
          name: ev.venue || title,
          lat,
          lon,
          sourceId: "hoopla",
          sourceUrl: url,
        });
      }
    } catch {
      /* city miss */
    }
  }
  return { places, events, sourceOk: ok || names.length === 0 };
}

async function odeon({ row, query }) {
  const aliases = row.geo?.aliases || {};
  const want = [...new Set((query.cities || []).map((id) => aliases[id]).filter(Boolean))].filter(
    (alias) => ODEON_VENUES[alias],
  );
  if (!want.length) return { places: [], events: [], sourceOk: true };
  const movies = await odeonMovieMap();
  const events = [];
  const places = [];
  const seenPlace = new Set();
  let ok = false;
  await Promise.all(
    want.map(async (alias) => {
      const venue = ODEON_VENUES[alias];
      if (!venue) return;
      const url = row.urlTemplate.replace("{alias}", alias);
      try {
        const data = await fetchJson(url, { referer: "https://www.odeonkino.no/" });
        ok = true;
        if (!keepPoint(venue.lat, venue.lon, query)) return;
        for (const show of data.items || []) {
          const ev = odeonEventFromShow(show, movies, venue, alias);
          if (!ev) continue;
          if (isReligionItem(ev)) continue;
          events.push(ev);
        }
        if (!seenPlace.has(alias)) {
          seenPlace.add(alias);
          places.push({
            id: hid("odeon-kino", "place", alias),
            name: venue.name,
            lat: venue.lat,
            lon: venue.lon,
            sourceId: "odeon-kino",
            sourceUrl: venue.page,
          });
        }
      } catch {
        /* alias miss */
      }
    }),
  );
  return { places, events, sourceOk: ok };
}

async function charlie({ query }) {
  const cities = query.cities || [];
  if (!cities.includes("porsgrunn") && !keepPoint(CHARLIE.lat, CHARLIE.lon, query)) {
    return { places: [], events: [], sourceOk: true };
  }
  try {
    const calendar = await fetchJson(
      "https://cw-data-api.dxn.no/v1/sites/site175a/basic_events",
      { referer: "https://charlie.no/", ua: "Mozilla/5.0" },
    );
    const events = [];
    const rows = Array.isArray(calendar) ? calendar : [];
    for (const row of rows) {
      if (!row.begin) continue;
      const startsAt = osloLocalToIso(row.begin) || row.begin;
      if (!startsAt || Number.isNaN(new Date(startsAt).getTime())) continue;
      const title = String(row.name || row.title || "").trim();
      if (!title || /^visning$/i.test(title)) continue;
      const ev = {
        id: hid("filmsentret-charlie", "event", String(row.key || row.begin)),
        title,
        startsAt,
        lat: CHARLIE.lat,
        lon: CHARLIE.lon,
        sourceUrl: row.purchase_url || "https://charlie.no/",
        sourceId: "filmsentret-charlie",
        venue: CHARLIE.name,
      };
      if (isReligionItem(ev)) continue;
      if (!keepPoint(ev.lat, ev.lon, query)) continue;
      events.push(ev);
    }
    return {
      places: [
        {
          id: hid("filmsentret-charlie", "place", "venue"),
          name: CHARLIE.name,
          lat: CHARLIE.lat,
          lon: CHARLIE.lon,
          sourceId: "filmsentret-charlie",
          sourceUrl: "https://charlie.no/",
        },
      ],
      events,
      sourceOk: true,
    };
  } catch {
    return { places: [], events: [], sourceOk: false };
  }
}

async function ticketmaster({ query }) {
  const key = globalThis.process?.env?.TICKETMASTER_API_KEY;
  if (!key) return { places: [], events: [], sourceOk: false, skipped: "no_key" };
  const bbox = queryBbox(query);
  if (!bbox) return { places: [], events: [], sourceOk: true };
  const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${encodeURIComponent(key)}&latlong=${((bbox.south + bbox.north) / 2).toFixed(4)},${((bbox.west + bbox.east) / 2).toFixed(4)}&radius=30&unit=km&countryCode=NO`;
  try {
    const data = await fetchJson(url);
    const events = [];
    for (const row of data._embedded?.events || []) {
      const title = String(row.name || "").trim();
      const startsAt = row.dates?.start?.dateTime;
      const loc = row._embedded?.venues?.[0];
      const lat = Number(loc?.location?.latitude);
      const lon = Number(loc?.location?.longitude);
      if (!title || !startsAt) continue;
      if (!keepPoint(lat, lon, query)) continue;
      const page = row.url;
      if (!page) continue;
      const ev = {
        id: hid("ticketmaster", "event", row.id),
        title,
        startsAt,
        lat,
        lon,
        sourceUrl: page,
        sourceId: "ticketmaster",
        venue: loc?.name || null,
      };
      if (isReligionItem(ev)) continue;
      events.push(ev);
    }
    return { places: [], events, sourceOk: true };
  } catch {
    return { places: [], events: [], sourceOk: false };
  }
}

async function http_json({ row, query }) {
  if (row.hubId === "hoopla") return hoopla({ row, query });
  if (row.hubId === "odeon-kino") return odeon({ row, query });
  if (row.hubId === "filmsentret-charlie") return charlie({ row, query });
  if (row.hubId === "ticketmaster") return ticketmaster({ row, query });
  return { places: [], events: [], sourceOk: true };
}

async function wp_rest({ row, query }) {
  try {
    const url = row.urlTemplate || row.url;
    const data = await fetchJson(url);
    const rows = Array.isArray(data) ? data : data.events || [];
    const events = [];
    for (const item of rows) {
      const title = String(item.title?.rendered || item.title || item.name || "").replace(/<[^>]+>/g, "").trim();
      const startsAt = wpStartsAt(item);
      if (!title || !startsAt) continue;
      let lat = Number(item.acf?.lat);
      let lon = Number(item.acf?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        if (row.hubId !== "ibsenhuset") continue;
        lat = IBSEN.lat;
        lon = IBSEN.lon;
      }
      if (!keepPoint(lat, lon, query)) continue;
      const page = item.link || url;
      const ev = {
        id: hid(row.hubId, "event", String(item.id || startsAt)),
        title,
        startsAt,
        lat,
        lon,
        sourceUrl: page,
        sourceId: row.hubId,
        venue: IBSEN.name,
      };
      if (isReligionItem(ev)) continue;
      events.push(ev);
    }
    return { places: [], events, sourceOk: true };
  } catch {
    return { places: [], events: [], sourceOk: false };
  }
}

export const adapters = { overpass, http_json, wp_rest };
