import { cacheKey, LIVE_CHECK_TTL_MS } from "./liveMath.js";

export async function runLiveCheck(query, { resolve, adapters, cache, now, onProgress } = {}) {
  const t = now ? now() : Date.now();
  const key = cacheKey(query);
  const prev = cache?.get(key) || null;
  if (prev && !query.force && cache) {
    const age = t - (prev._cachedAt ?? 0);
    if (age >= 0 && age < LIVE_CHECK_TTL_MS) return prev;
  }

  const rows = resolve ? resolve(query) : [];
  const places = [];
  const events = [];
  const sources = [];
  const byHub = { ...(prev?.byHub || {}) };

  const settled = await Promise.all(
    rows.map(async (row) => {
      const fn = adapters?.[row.adapterKind];
      let result = { places: [], events: [], sourceOk: false };
      try {
        if (fn) result = await fn({ row, query });
      } catch {
        result = { places: [], events: [], sourceOk: false };
      }
      return { row, result };
    }),
  );

  let done = 0;
  for (const { row, result: raw } of settled) {
    let result = raw;
    done += 1;
    onProgress?.({ done, total: rows.length, label: row.hubId });
    if (result.skipped) {
      sources.push({
        id: row.hubId,
        ok: false,
        n: 0,
        skip: result.skipped,
      });
      continue;
    }
    if (!result.sourceOk && byHub[row.hubId]) {
      result = { ...byHub[row.hubId], sourceOk: false };
    } else if (result.sourceOk) {
      byHub[row.hubId] = {
        places: result.places || [],
        events: result.events || [],
        sourceOk: true,
      };
    }
    for (const p of result.places || []) places.push(p);
    for (const e of result.events || []) events.push(e);
    sources.push({
      id: row.hubId,
      ok: Boolean(result.sourceOk),
      n: (result.places?.length || 0) + (result.events?.length || 0),
    });
  }

  const out = {
    places,
    events,
    checkedAt: new Date(t).toISOString(),
    sources,
    byHub,
    _cachedAt: t,
  };
  cache?.set(key, out);
  return out;
}
