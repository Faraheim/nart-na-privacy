/**
 * Device live-check. No Owner API. Baked catalog + fetchables + kommuner.
 */
import { parseLiveCheckQuery } from "./liveMath.js";
import { resolveFetchables } from "./resolveFetchables.js";
import { runLiveCheck } from "./runLiveCheck.js";
import { adapters as defaultAdapters, bindLiveGeo } from "./liveAdaptersCore.js";
import {
  expandCitySelectionFrom,
  uniqueCitiesFrom,
  citiesOverlappingNearBbox,
  pointInOmrade,
  fetchKommuneOmrade,
} from "./clientScope.js";

const cache = new Map();

function cityForPointFromPolygons(polygons) {
  return (lat, lon) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    for (const [id, omrade] of Object.entries(polygons || {})) {
      if (pointInOmrade(lon, lat, omrade)) return id;
    }
    return null;
  };
}

export async function runClientLiveCheck({
  body,
  catalog,
  fetchables,
  kommunerDoc,
  adapters,
  fetchOmrade,
  cacheMap,
  now,
} = {}) {
  const parsed = parseLiveCheckQuery(body);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };

  let query = { ...parsed.query };
  const cities = new Set(expandCitySelectionFrom(kommunerDoc, query.cities || []));
  query.filterCities = [...cities];
  if (query.near) {
    for (const id of citiesOverlappingNearBbox(kommunerDoc, query.near)) cities.add(id);
  }
  query.cities = [...cities];

  const polygons = {};
  const byId = uniqueCitiesFrom(kommunerDoc);
  const fetchPoly = fetchOmrade || fetchKommuneOmrade;
  const omradeIds = query.filterCities.slice(0, 8);
  await Promise.all(
    omradeIds.map(async (id) => {
      const row = byId.find((c) => c.id === id);
      const nr = row?.kommuneNr?.[0];
      if (!nr) return;
      try {
        polygons[id] = await fetchPoly(nr);
      } catch {
        /* bbox-only keep for this kommune */
      }
    }),
  );
  query.polygons = polygons;
  query.uniqueCities = () => uniqueCitiesFrom(kommunerDoc);
  query.cityForPoint = cityForPointFromPolygons(polygons);

  bindLiveGeo({
    cityForPoint: query.cityForPoint,
    uniqueCities: query.uniqueCities,
  });

  const fylkeNrByCity = Object.fromEntries(uniqueCitiesFrom(kommunerDoc).map((c) => [c.id, c.fylkeNr]));
  const rowsDoc = fetchables?.rows || fetchables || [];

  const result = await runLiveCheck(query, {
    resolve: (q) =>
      resolveFetchables({
        query: q,
        catalog,
        fetchables: rowsDoc,
        citiesMeta: {
          fylkeNrByCity,
          expandCitySelection: (ids) => expandCitySelectionFrom(kommunerDoc, ids),
        },
      }),
    adapters: adapters || defaultAdapters,
    cache: cacheMap || cache,
    now: now || Date.now,
  });

  return {
    status: 200,
    body: {
      places: result.places || [],
      events: result.events || [],
      checkedAt: result.checkedAt,
      sources: result.sources || [],
    },
  };
}
