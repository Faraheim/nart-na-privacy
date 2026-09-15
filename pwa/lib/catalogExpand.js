/** Catalog group ids → activity item ids. Group `film` does not exist. */

export function groupIdsToActivityIds(catalog, groupIds) {
  const want = new Set((groupIds || []).map(String));
  const out = new Set();
  for (const g of catalog?.groups || []) {
    if (!want.has(g.id)) continue;
    for (const it of g.items || []) {
      if (it?.id) out.add(it.id);
    }
  }
  return [...out].sort();
}
