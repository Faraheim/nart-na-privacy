import { groupIdsToActivityIds } from "./catalogExpand.js";

const CAP = 12;

function geoHits(row, citySet, fylkeNrByCity, near) {
  const g = row.geo || {};
  const type = g.type;
  if (type === "national" || type === "bbox" || type === "kommune_c") {
    return citySet.size > 0 || Boolean(near);
  }
  if (type === "kommune" || type === "chain_cities") {
    return (g.cityIds || []).some((id) => citySet.has(id));
  }
  if (type === "fylke") {
    for (const id of citySet) {
      if (fylkeNrByCity[id] === g.fylkeNr) return true;
    }
    return false;
  }
  return false;
}

function sortKey(row) {
  if (row.hubId === "osm-overpass") return `0-${row.id}`;
  if (row.adapterKind === "overpass") return `1-${row.id}`;
  return `2-${row.id}`;
}

export function resolveFetchables({ query, catalog, fetchables, citiesMeta }) {
  const activities = new Set(groupIdsToActivityIds(catalog, query.groups || []));
  const expand = citiesMeta?.expandCitySelection || ((ids) => ids || []);
  const citySet = new Set();
  for (const id of query.cities || []) citySet.add(id);
  for (const id of expand(query.cities || [])) citySet.add(id);
  const fylkeNrByCity = citiesMeta?.fylkeNrByCity || {};

  const matched = [];
  for (const row of fetchables || []) {
    if (row.gate && row.gate !== "live") continue;
    const acts = row.activityIds || [];
    if (!acts.some((a) => activities.has(a))) continue;
    if (!geoHits(row, citySet, fylkeNrByCity, query.near)) continue;
    matched.push({
      ...row,
      activityIds: acts.filter((a) => activities.has(a)),
    });
  }
  matched.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const osm = matched.filter((r) => r.hubId === "osm-overpass");
  const rest = matched.filter((r) => r.hubId !== "osm-overpass");
  const out = [...osm, ...rest].slice(0, CAP);
  if (osm.length && !out.some((r) => r.hubId === "osm-overpass")) {
    out[out.length - 1] = osm[0];
  }
  return out;
}
