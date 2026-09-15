import { runClientLiveCheck } from './lib/clientLiveCheck.js';
import { catalogFromKommuner } from './lib/clientScope.js';

const citiesSel = new Set();
const groupsSel = new Set();
let mode = 'happening';
let nearMe = false;
let nearCoords = null;
let lastLiveForce = false;
let catalog = { cities: [], groups: [], fylker: [] };
let kommunerDoc = { fylker: [], kommuner: [], aliases: {} };
let activityCatalog = { groups: [] };
let fetchables = { rows: [] };
let cityQuery = '';
let map;
let layer;
let selected = null;

const statusEl = document.getElementById('status');
const listEl = document.getElementById('list');
const listSummary = document.getElementById('listSummary');
const sheetEl = document.getElementById('sheet');
const backdropEl = document.getElementById('sheetBackdrop');

function closeMenus(except) {
  for (const id of ['cityMenu', 'groupMenu', 'modeMenu']) {
    if (except && id === except) continue;
    document.getElementById(id).hidden = true;
  }
  for (const id of ['cityBtn', 'groupBtn', 'modeBtn']) {
    document.getElementById(id).setAttribute('aria-expanded', 'false');
  }
}

function toggleMenu(btnId, menuId) {
  const menu = document.getElementById(menuId);
  const open = menu.hidden;
  closeMenus(menuId);
  menu.hidden = !open;
  document.getElementById(btnId).setAttribute('aria-expanded', String(open));
}

function checkRow(label, on, onclick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `dd-item${on ? ' on' : ''}`;
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = on;
  box.tabIndex = -1;
  const span = document.createElement('span');
  span.textContent = label;
  b.append(box, span);
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onclick();
  });
  return b;
}

function catalogFylker() {
  if (catalog.fylker?.length) return catalog.fylker;
  return [{ id: 'fylke-legacy', name: 'Kommuner', kommuner: catalog.cities || [] }];
}

function citySelectionLabels() {
  const labels = [];
  for (const f of catalogFylker()) {
    if (citiesSel.has(f.id)) labels.push(f.name);
    for (const k of f.kommuner || []) {
      if (citiesSel.has(k.id)) labels.push(k.label);
    }
  }
  return labels;
}

function toggleCity(id) {
  citiesSel.has(id) ? citiesSel.delete(id) : citiesSel.add(id);
  renderFilters('city');
  load();
}

function renderFilters(keep) {
  const cityBtn = document.getElementById('cityBtn');
  const groupBtn = document.getElementById('groupBtn');
  const modeBtn = document.getElementById('modeBtn');
  const cityLabels = citySelectionLabels();
  const groupLabels = catalog.groups.filter((g) => groupsSel.has(g.id)).map((g) => g.label);
  cityBtn.textContent = cityLabels.length
    ? `Sted: ${cityLabels.length > 2 ? `${cityLabels.slice(0, 2).join(', ')} +${cityLabels.length - 2}` : cityLabels.join(', ')} ▾`
    : 'Sted ▾';
  cityBtn.classList.toggle('on', citiesSel.size > 0);
  groupBtn.textContent = groupLabels.length
    ? `Tema (${groupLabels.length}): ${groupLabels.length > 2 ? `${groupLabels.slice(0, 2).join(', ')} +${groupLabels.length - 2}` : groupLabels.join(', ')} ▾`
    : 'Tema ▾';
  groupBtn.classList.toggle('on', groupsSel.size > 0);
  const modeLabel = mode === 'places' ? 'Steder' : mode === 'tonight' ? 'I kveld' : 'Program';
  modeBtn.textContent = `Vis: ${modeLabel} ▾`;

  const cityMenu = document.getElementById('cityMenu');
  const q = cityQuery.trim().toLowerCase();
  const nodes = [];
  const search = document.createElement('input');
  search.className = 'dd-search';
  search.type = 'search';
  search.placeholder = 'Søk kommune…';
  search.value = cityQuery;
  search.addEventListener('input', () => {
    cityQuery = search.value;
    renderFilters('city');
    const next = document.querySelector('#cityMenu .dd-search');
    if (next) {
      next.focus();
      next.selectionStart = next.selectionEnd = next.value.length;
    }
  });
  nodes.push(search);
  for (const f of catalogFylker()) {
    const kommuner = (f.kommuner || []).filter((k) => !q || k.label.toLowerCase().includes(q) || f.name.toLowerCase().includes(q));
    if (q && !kommuner.length && !f.name.toLowerCase().includes(q)) continue;
    const head = document.createElement('div');
    head.className = 'dd-fylke';
    head.textContent = f.name;
    nodes.push(head);
    nodes.push(
      checkRow(`Hele ${f.name}`, citiesSel.has(f.id), () => toggleCity(f.id)),
    );
    for (const k of kommuner) {
      const mark = k.claimed ? '' : ' · identitet';
      const row = checkRow(`${k.label}${mark}`, citiesSel.has(k.id), () => toggleCity(k.id));
      if (!k.claimed) row.querySelector('span')?.classList.add('dd-gap');
      nodes.push(row);
    }
  }
  cityMenu.replaceChildren(...nodes);
  const groupMenu = document.getElementById('groupMenu');
  groupMenu.replaceChildren(
    ...catalog.groups.map((g) =>
      checkRow(g.label, groupsSel.has(g.id), () => {
        groupsSel.has(g.id) ? groupsSel.delete(g.id) : groupsSel.add(g.id);
        renderFilters('group');
        load();
      }),
    ),
  );
  const modeMenu = document.getElementById('modeMenu');
  modeMenu.replaceChildren(
    ...[
      ['happening', 'Program'],
      ['tonight', 'I kveld'],
      ['places', 'Steder'],
    ].map(([id, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `dd-item${mode === id ? ' on' : ''}`;
      b.textContent = label;
      b.addEventListener('click', () => {
        mode = id;
        closeMenus();
        renderFilters();
        load();
      });
      return b;
    }),
  );
  if (keep === 'city') {
    document.getElementById('cityMenu').hidden = false;
    document.getElementById('cityBtn').setAttribute('aria-expanded', 'true');
  }
  if (keep === 'group') {
    document.getElementById('groupMenu').hidden = false;
    document.getElementById('groupBtn').setAttribute('aria-expanded', 'true');
  }
}

function ready() {
  return (citiesSel.size > 0 || nearMe) && groupsSel.size > 0;
}

function ensureMap() {
  if (map) return;
  map = L.map('map', { zoomControl: false, attributionControl: false }).setView([59.2, 9.64], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 18,
  }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  layer = L.layerGroup().addTo(map);
  map.on('click', closeSheet);
}

function pinColor(kind) {
  return kind === 'event' ? '#b4543c' : '#3d7a86';
}

const liveById = new Map();

function liveToFeatures(live) {
  liveById.clear();
  const features = [];
  for (const p of live.places || []) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: {
        kind: 'place',
        id: p.id,
        name: p.name,
        categories: p.categories || [],
        sourceId: p.sourceId,
        sourceUrl: p.sourceUrl,
      },
    });
  }
  for (const e of live.events || []) {
    if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon) || !e.startsAt) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
      properties: {
        kind: 'event',
        id: e.id,
        name: e.title,
        startsAt: e.startsAt,
        sourceId: e.sourceId,
        sourceUrl: e.sourceUrl,
        deepLink: e.deepLink || e.sourceUrl,
        venue: e.venue,
      },
    });
  }
  for (const f of features) liveById.set(f.properties.id, f.properties);
  return features;
}

async function postLiveCheck(force) {
  const body = {
    groups: [...groupsSel],
    force: Boolean(force),
  };
  if (citiesSel.size) body.cities = [...citiesSel];
  if (nearMe && nearCoords) body.near = { lat: nearCoords.lat, lon: nearCoords.lon, km: 30 };
  const r = await runClientLiveCheck({
    body,
    catalog: activityCatalog,
    fetchables,
    kommunerDoc,
  });
  if (r.status !== 200) throw new Error(`live-check ${r.status}`);
  return r.body;
}

function formatWhen(ev) {
  if (ev.ongoing || ev.statusLabel === 'Pågående') return 'Pågående';
  if (ev.statusLabel) return ev.statusLabel;
  const t = new Date(ev.startsAt);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleString('nb-NO', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function closeSheet() {
  selected = null;
  sheetEl.hidden = true;
  if (backdropEl) backdropEl.hidden = true;
}

function renderProgram(pin) {
  const box = document.getElementById('sheetProgram');
  box.replaceChildren();
  const events = (pin.window?.length ? pin.window : pin.program?.length ? pin.program : pin.next ? [pin.next] : []).slice(0, 12);
  const heading = document.createElement('p');
  heading.className = 'kind';
  heading.textContent = pin.sheet?.heading || 'Neste i programmet';
  box.append(heading);
  if (!events.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = pin.sheet?.empty || 'Ingen bekreftet program ennå.';
    box.append(empty);
    return;
  }
  for (const ev of events) {
    const row = document.createElement(ev.deepLink || ev.sourceUrl ? 'a' : 'div');
    row.className = 'ev';
    if (row.tagName === 'A') {
      row.href = ev.deepLink || ev.sourceUrl;
      row.target = '_blank';
      row.rel = 'noopener';
    }
    const when = document.createElement('div');
    when.className = 'when';
    when.textContent = formatWhen(ev);
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = ev.title;
    row.append(when, title);
    if (ev.artists) {
      const d = document.createElement('div');
      d.className = 'desc';
      d.textContent = `Spiller: ${ev.artists}`;
      row.append(d);
    } else if (ev.description) {
      const d = document.createElement('div');
      d.className = 'desc';
      d.textContent = ev.description;
      row.append(d);
    }
    box.append(row);
  }
}

function renderSheet(pin) {
  document.getElementById('sheetKind').textContent = pin.kind === 'event' ? 'Arrangement' : 'Sted';
  document.getElementById('sheetTitle').textContent = pin.title;
  document.getElementById('sheetMeta').textContent = (pin.categories || []).join(' · ');
  const links = document.getElementById('sheetLinks');
  links.replaceChildren();
  for (const l of pin.links || []) {
    const a = document.createElement('a');
    a.href = l.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = l.label;
    links.append(a);
  }
  renderProgram(pin);
  sheetEl.hidden = false;
  if (backdropEl) backdropEl.hidden = false;
  document.getElementById('listFold').open = false;
}

function sheetFromLive(kind, props) {
  const url = props.deepLink || props.sourceUrl;
  const window = props.startsAt
    ? [{ title: props.name, startsAt: props.startsAt, deepLink: url, sourceUrl: url }]
    : [];
  return {
    kind,
    title: props.name || 'Live-treff',
    categories: props.categories || [],
    sheet: { heading: 'Fra live-sjekk', empty: 'Ingen bekreftet program i dette treffet.' },
    links: url ? [{ label: 'Kilde', url }] : [],
    window,
  };
}

async function openPin(kind, id) {
  selected = { kind, id };
  const live = liveById.get(id);
  if (live) {
    renderSheet(sheetFromLive(kind, live));
    return;
  }
  renderSheet({
    kind,
    title: 'Ingen mer info',
    categories: [],
    sheet: { heading: 'Fra live-sjekk', empty: 'Dette treffet har bare kart-prikken.' },
    links: [],
    window: [],
  });
}

async function load() {
  if (!ready()) {
    statusEl.textContent = 'Velg fylke eller kommune og tema. Vi henter bare det.';
    listSummary.textContent = 'Forslag';
    listEl.innerHTML = '<div class="empty">Ingenting lastes ennå. Velg minst én by og ett tema.</div>';
    if (layer) layer.clearLayers();
    closeSheet();
    return;
  }
  statusEl.textContent = 'Sjekker kartlagte kilder…';
  try {
    const live = await postLiveCheck(lastLiveForce).catch(() => null);
    lastLiveForce = false;
    const features = live ? liveToFeatures(live) : [];
    const items = [
      ...(live?.events || []).map((e) => ({
        kind: 'event',
        id: e.id,
        name: e.title,
        statusLabel: e.startsAt,
      })),
      ...(live?.places || []).map((p) => ({
        kind: 'place',
        id: p.id,
        name: p.name,
        statusLabel: p.sourceId,
      })),
    ].slice(0, 16);
    const ok = (live?.sources || []).filter((s) => s.ok).length;
    const n = (live?.sources || []).length;
    const srcLine = n ? ` · kilder ok ${ok}/${n}` : '';
    statusEl.textContent = `${features.length} treff · ${items.length} forslag${srcLine}`;
    listSummary.textContent = items.length ? `Forslag (${items.length})` : 'Forslag';
    listEl.replaceChildren(
      ...(items.length
        ? items.map((item) => {
            const el = document.createElement('article');
            el.className = 'card';
            el.innerHTML = `<div class="kind"></div><h3></h3><p></p>`;
            el.querySelector('.kind').textContent = item.kind === 'event' ? 'Nå / snart' : 'Sted';
            el.querySelector('h3').textContent = item.name;
            el.querySelector('p').textContent = item.statusLabel || '';
            el.addEventListener('click', () => openPin(item.kind === 'event' ? 'event' : 'place', item.id));
            return el;
          })
        : [
            Object.assign(document.createElement('div'), {
              className: 'empty',
              textContent: 'Ingen treff i de live kildene for dette filteret ennå.',
            }),
          ]),
    );
    ensureMap();
    layer.clearLayers();
    const bounds = [];
    for (const f of features) {
      const [lng, lat] = f.geometry.coordinates;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      bounds.push([lat, lng]);
      L.circleMarker([lat, lng], {
        radius: 12,
        color: pinColor(f.properties.kind),
        weight: 2,
        fillOpacity: 0.9,
      })
        .bindTooltip(f.properties.name, { direction: 'top', opacity: 0.95 })
        .on('click', (ev) => {
          L.DomEvent.stopPropagation(ev);
          void openPin(f.properties.kind === 'event' ? 'event' : 'place', f.properties.id);
        })
        .addTo(layer);
    }
    if (bounds.length) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 13 });
  } catch (err) {
    statusEl.textContent = 'Klarte ikke å sjekke kilder (nett).';
    listEl.innerHTML = `<div class="empty">${err.message || 'Nettfeil'}</div>`;
  }
}

async function boot() {
  document.getElementById('cityBtn').addEventListener('click', () => toggleMenu('cityBtn', 'cityMenu'));
  document.getElementById('groupBtn').addEventListener('click', () => toggleMenu('groupBtn', 'groupMenu'));
  document.getElementById('modeBtn').addEventListener('click', () => toggleMenu('modeBtn', 'modeMenu'));
  document.getElementById('nearBtn').addEventListener('click', () => {
    if (nearMe) {
      nearMe = false;
      nearCoords = null;
      document.getElementById('nearBtn').classList.remove('on');
      load();
      return;
    }
    if (!navigator.geolocation) {
      statusEl.textContent = 'Nettleseren har ikke posisjon.';
      return;
    }
    statusEl.textContent = 'Henter posisjon…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        nearMe = true;
        nearCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        document.getElementById('nearBtn').classList.add('on');
        load();
      },
      () => {
        statusEl.textContent = 'Kunne ikke hente posisjon.';
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 },
    );
  });
  document.getElementById('refreshBtn').addEventListener('click', () => {
    lastLiveForce = true;
    load();
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('.dd') || e.target.closest('.sheet')) return;
    closeMenus();
  });
  document.getElementById('sheetClose').addEventListener('click', closeSheet);
  backdropEl?.addEventListener('click', closeSheet);
  try {
    const [kommuner, groups, liveRows] = await Promise.all([
      fetch('./data/kommuner.json').then((r) => {
        if (!r.ok) throw new Error(`kommuner ${r.status}`);
        return r.json();
      }),
      fetch('./data/activity_catalog.json').then((r) => {
        if (!r.ok) throw new Error(`aktivitet ${r.status}`);
        return r.json();
      }),
      fetch('./data/live_fetchables.json').then((r) => {
        if (!r.ok) throw new Error(`kilder ${r.status}`);
        return r.json();
      }),
    ]);
    kommunerDoc = kommuner;
    activityCatalog = groups;
    fetchables = liveRows;
    catalog = catalogFromKommuner(kommuner, groups);
  } catch (err) {
    catalog = { fylker: [], cities: [], groups: [] };
    statusEl.textContent = err.message || 'Mangler bakte kartdata.';
  }
  renderFilters();
  load();
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.getRegistrations().then((regs) => Promise.all(regs.map((r) => r.unregister())));
  }
}

boot();
