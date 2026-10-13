// Pick Path Lab — user interface. Vanilla JS, no dependencies.
import {
  DEFAULT_GENERATOR,
  DEFAULT_SETTINGS,
  SEQUENCE_MODES,
  abcClasses,
  autoSlot,
  cellPath,
  clone,
  demandFromHistory,
  emptyLayout,
  fillSkus,
  generateRacks,
  naturalCompare,
  parseDemandCsv,
  parseOrdersCsv,
  pickFaceCell,
  prepareLayout,
  sampleProject,
  simulate,
  uid
} from './engine.js';

const STORAGE_KEY = 'pickpathlab.project.v1';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
const fmt = (v, d = 1) =>
  Number.isFinite(v)
    ? v.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })
    : '–';
const eur = (v, d = 0) =>
  Number.isFinite(v)
    ? v.toLocaleString('it-IT', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: d,
        maximumFractionDigits: d
      })
    : '–';
const signed = (v, d = 1) => (v > 0.0005 ? '+' : '') + fmt(v, d);
const toNum = (v, fallback = 0) => {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
};
const FACES = { N: 'Nord (alto)', S: 'Sud (basso)', E: 'Est (destra)', W: 'Ovest (sinistra)' };
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const state = {
  project: null,
  activeId: null,
  selected: null,
  tool: 'select',
  tab: 'layout',
  run: null,
  stale: false,
  routeIdx: 0,
  heat: false,
  labels: true,
  visitsLayout: null,
  anim: null
};

const active = () =>
  state.project.layouts.find((l) => l.id === state.activeId) || state.project.layouts[0];
const baseline = () => state.project.layouts.find((l) => l.include !== false);
const selectedLoc = () => active()?.locations.find((l) => l.id === state.selected) || null;

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.project));
  } catch {
    /* storage unavailable: the page keeps working without it */
  }
}
function loadSaved() {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}

function normalizeProject(p) {
  if (!p || !Array.isArray(p.layouts) || p.layouts.length === 0) {
    throw new Error('Il file non contiene layout validi.');
  }
  const out = {
    version: 1,
    name: p.name || 'Progetto',
    demand: Array.isArray(p.demand)
      ? p.demand
          .filter((d) => d && d.sku)
          .map((d) => ({ sku: String(d.sku), weight: toNum(d.weight) }))
      : [],
    history: Array.isArray(p.history) ? p.history : [],
    settings: { ...DEFAULT_SETTINGS, ...(p.settings || {}) },
    layouts: p.layouts.map((l) => ({
      ...emptyLayout(),
      ...l,
      id: l.id || uid('layout'),
      start: { x: toNum(l.start?.x, 1), y: toNum(l.start?.y, 1) },
      end: { x: toNum(l.end?.x ?? l.start?.x, 1), y: toNum(l.end?.y ?? l.start?.y, 1) },
      sameEnd: l.sameEnd !== false,
      include: l.include !== false,
      generator: { ...DEFAULT_GENERATOR, ...(l.generator || {}) },
      locations: (l.locations || []).map((loc) => ({
        id: String(loc.id),
        x: Math.round(toNum(loc.x)),
        y: Math.round(toNum(loc.y)),
        w: Math.max(1, Math.round(toNum(loc.w, 1))),
        d: Math.max(1, Math.round(toNum(loc.d, 1))),
        face: FACES[loc.face] ? loc.face : 'E',
        stock: (loc.stock || [])
          .filter((s) => s && s.sku)
          .map((s) => ({ sku: String(s.sku), qty: toNum(s.qty, 0) }))
      }))
    }))
  };
  return out;
}

function notify(text, kind = 'info') {
  const el = $('#notice');
  el.textContent = text;
  el.className = 'notice' + (kind === 'error' ? ' error' : '');
  el.hidden = false;
  clearTimeout(notify.t);
  notify.t = setTimeout(() => (el.hidden = true), kind === 'error' ? 9000 : 5000);
}

// Any edit: persist, mark results stale and redraw what depends on it.
function changed(parts = ['layout']) {
  if (state.run) state.stale = true;
  save();
  stopAnim();
  renderSteps();
  if (parts.includes('layout')) {
    renderLayoutList();
    renderMap();
    renderInspector();
    renderRouteBar();
    renderIssues();
  }
  if (parts.includes('geometry')) renderGeometry();
  if (parts.includes('generator')) renderGenerator();
  if (parts.includes('demand')) {
    renderDemand();
    renderHistory();
  }
  if (parts.includes('settings')) renderSettings();
  renderResults();
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

function setTab(tab) {
  state.tab = tab;
  for (const b of document.querySelectorAll('#steps .step'))
    b.classList.toggle('active', b.dataset.tab === tab);
  for (const t of ['layout', 'demand', 'sim', 'results']) $('#tab-' + t).hidden = t !== tab;
  if (tab !== 'layout') stopAnim();
}

function renderSteps() {
  const btn = $('#steps [data-tab="results"]');
  btn.innerHTML =
    '<b>4</b> Risultati' + (state.stale ? ' <i class="dot" title="Input modificati"></i>' : '');
}

/* ------------------------------------------------------------------ */
/* Layout list and actions                                             */
/* ------------------------------------------------------------------ */

function renderLayoutList() {
  const base = baseline();
  const cards = state.project.layouts
    .map((l) => {
      const isActive = l.id === active().id;
      return `<div class="lcard${isActive ? ' active' : ''}" data-layout="${esc(
        l.id
      )}" role="button" tabindex="0" aria-pressed="${isActive}">
        <input type="checkbox" data-include="${esc(l.id)}" ${
        l.include !== false ? 'checked' : ''
      } title="Includi nel confronto" aria-label="Includi ${esc(l.name)} nel confronto" />
        <span class="lname">${esc(l.name)} ${
        base && base.id === l.id ? '<span class="tag">Baseline</span>' : ''
      }</span>
        <span class="lmeta">${l.width} × ${l.depth} m · ${l.locations.length} ubicazioni</span>
      </div>`;
    })
    .join('');
  const L = active();
  const isBase = base && base.id === L.id;
  $('#layout-list').innerHTML = `${cards}
    <div class="layout-actions">
      <button type="button" class="btn small" data-act="new">+ Nuovo</button>
      <button type="button" class="btn small" data-act="dup">Duplica</button>
      <button type="button" class="btn small" data-act="slot" title="Crea una variante con gli SKU più richiesti sulle ubicazioni più vicine">Variante slotting ABC</button>
      <button type="button" class="btn small" data-act="base" ${
        isBase ? 'disabled' : ''
      }>Imposta come baseline</button>
      <button type="button" class="btn small danger" data-act="del" ${
        state.project.layouts.length < 2 ? 'disabled' : ''
      }>Elimina</button>
    </div>`;
}

function layoutAction(act) {
  const P = state.project;
  const L = active();
  if (act === 'new') {
    const n = emptyLayout(`Layout ${P.layouts.length + 1}`);
    n.width = L.width;
    n.depth = L.depth;
    P.layouts.push(n);
    state.activeId = n.id;
    notify(
      'Layout vuoto creato. Usa il generatore di scaffalature o lo strumento "Aggiungi scaffale".'
    );
    $('#generator-panel').open = true;
  } else if (act === 'dup') {
    const d = clone(L);
    d.id = uid('layout');
    d.name = `${L.name} (copia)`;
    P.layouts.splice(P.layouts.indexOf(L) + 1, 0, d);
    state.activeId = d.id;
  } else if (act === 'slot') {
    if (!L.locations.some((l) => l.stock?.length)) {
      notify('Il layout attivo non ha stock assegnato: niente da riposizionare.', 'error');
      return;
    }
    const s = autoSlot(L, P.demand);
    P.layouts.splice(P.layouts.indexOf(L) + 1, 0, s);
    state.activeId = s.id;
    notify(
      'Variante creata: stesse ubicazioni e quantità, SKU riposizionati per frequenza di prelievo.'
    );
  } else if (act === 'base') {
    P.layouts.splice(P.layouts.indexOf(L), 1);
    P.layouts.unshift(L);
    L.include = true;
  } else if (act === 'del') {
    if (P.layouts.length < 2) return;
    if (state.pendingDelete !== L.id) {
      state.pendingDelete = L.id;
      notify(`Premi di nuovo "Elimina" per eliminare «${L.name}».`);
      setTimeout(() => (state.pendingDelete = null), 4000);
      return;
    }
    state.pendingDelete = null;
    P.layouts.splice(P.layouts.indexOf(L), 1);
    state.activeId = P.layouts[0].id;
  }
  state.selected = null;
  changed(['layout', 'geometry', 'generator', 'settings']);
}

/* ------------------------------------------------------------------ */
/* Geometry and generator                                              */
/* ------------------------------------------------------------------ */

const numField = (label, key, value, attrs = '', hint = '') =>
  `<label class="field"><span>${label}</span><input type="number" id="f-${key}" data-k="${key}" value="${esc(
    value
  )}" ${attrs} />${hint ? `<small>${hint}</small>` : ''}</label>`;

function renderGeometry() {
  const L = active();
  $('#geometry').innerHTML = `
    <div class="panel-head"><h3>Geometria del layout attivo</h3></div>
    <label class="field"><span>Nome</span><input type="text" id="g-name" data-g="name" value="${esc(
      L.name
    )}" /></label>
    <div class="grid">
      ${numField('Larghezza (m)', 'width', L.width, 'data-g="width" min="4" max="300" step="1"')}
      ${numField('Profondità (m)', 'depth', L.depth, 'data-g="depth" min="4" max="300" step="1"')}
    </div>
    <div class="grid">
      ${numField('Partenza X (m)', 'sx', L.start.x, 'data-g="start.x" min="0" step="1"')}
      ${numField('Partenza Y (m)', 'sy', L.start.y, 'data-g="start.y" min="0" step="1"')}
    </div>
    <label class="check"><input type="checkbox" id="g-same" data-g="sameEnd" ${
      L.sameEnd ? 'checked' : ''
    } /> L'operatore torna al punto di partenza</label>
    ${
      L.sameEnd
        ? ''
        : `<div class="grid">
      ${numField('Arrivo X (m)', 'ex', L.end.x, 'data-g="end.x" min="0" step="1"')}
      ${numField('Arrivo Y (m)', 'ey', L.end.y, 'data-g="end.y" min="0" step="1"')}
    </div>`
    }
    <p class="hint">Coordinate in metri dall'angolo in alto a sinistra. Puoi anche posare partenza e arrivo cliccando sulla pianta.</p>`;
}

function onGeometryChange(e) {
  const key = e.target.dataset.g;
  if (!key) return;
  const L = active();
  if (key === 'name') L.name = e.target.value.trim() || L.name;
  else if (key === 'sameEnd') {
    L.sameEnd = e.target.checked;
    if (!L.sameEnd) L.end = { ...L.start };
  } else {
    const v = Math.round(toNum(e.target.value));
    if (key === 'width' || key === 'depth') L[key] = Math.min(300, Math.max(4, v));
    else {
      const [obj, axis] = key.split('.');
      const lim = axis === 'x' ? L.width - 1 : L.depth - 1;
      L[obj][axis] = Math.min(lim, Math.max(0, v));
      if (obj === 'start' && L.sameEnd) L.end = { ...L.start };
    }
  }
  changed(['layout', 'geometry']);
}

function renderGenerator() {
  const g = { ...DEFAULT_GENERATOR, ...active().generator };
  $('#generator').innerHTML = `
    <p class="hint">Riempie il perimetro del layout attivo con file di scaffali bifronte separate da corridoi. Le ubicazioni sono nominate per fila (A, B, C…) e campata (1, 2, 3…).</p>
    <div class="grid">
      <label class="field"><span>Orientamento corridoi</span>
        <select id="gen-orientation" data-gen="orientation">
          <option value="vertical" ${
            g.orientation === 'vertical' ? 'selected' : ''
          }>Dall'alto in basso</option>
          <option value="horizontal" ${
            g.orientation === 'horizontal' ? 'selected' : ''
          }>Da sinistra a destra</option>
        </select></label>
      ${numField(
        'Corridoio (m)',
        'gen-aisle',
        g.aisle,
        'data-gen="aisle" min="1" max="10" step="1"'
      )}
      ${numField(
        'Profondità scaffale (m)',
        'gen-rd',
        g.rackDepth,
        'data-gen="rackDepth" min="1" max="5" step="1"'
      )}
      ${numField(
        'Lunghezza campata (m)',
        'gen-bl',
        g.bayLength,
        'data-gen="bayLength" min="1" max="10" step="1"'
      )}
      ${numField(
        'Fascia di testa (m)',
        'gen-fa',
        g.frontAisle,
        'data-gen="frontAisle" min="1" max="20" step="1"',
        'Spazio libero lato partenza'
      )}
      ${numField(
        'Max ubicazioni',
        'gen-max',
        g.maxLocations,
        'data-gen="maxLocations" min="0" step="1"',
        '0 = riempi tutto'
      )}
      ${numField(
        'Pezzi per ubicazione',
        'gen-qty',
        g.qtyPerSlot,
        'data-gen="qtyPerSlot" min="1" step="1"'
      )}
      <label class="field"><span>Assegnazione SKU</span>
        <select id="gen-placement" data-gen="placement">
          <option value="random" ${
            g.placement !== 'catalogue' && g.placement !== 'abc' && g.placement !== 'none'
              ? 'selected'
              : ''
          }>Casuale (come per data di arrivo)</option>
          <option value="catalogue" ${
            g.placement === 'catalogue' ? 'selected' : ''
          }>Ordine di catalogo</option>
          <option value="abc" ${g.placement === 'abc' ? 'selected' : ''}>Slotting ABC</option>
          <option value="none" ${g.placement === 'none' ? 'selected' : ''}>Nessuna (vuote)</option>
        </select></label>
    </div>
    <div class="row">
      <label class="check"><input type="checkbox" id="gen-back" data-gen="backAisle" ${
        g.backAisle ? 'checked' : ''
      } /> Corridoio di fondo</label>
      <label class="check"><input type="checkbox" id="gen-cross" data-gen="crossAisle" ${
        g.crossAisle ? 'checked' : ''
      } /> Corridoio trasversale centrale</label>
    </div>
    <div class="row">
      <button type="button" class="btn dark" data-gen-act="replace">Rigenera il layout attivo</button>
      <button type="button" class="btn" data-gen-act="new">Crea come nuovo layout</button>
    </div>`;
}

function onGeneratorChange(e) {
  const key = e.target.dataset.gen;
  if (!key) return;
  const g = (active().generator = { ...DEFAULT_GENERATOR, ...active().generator });
  if (e.target.type === 'checkbox') g[key] = e.target.checked;
  else if (e.target.tagName === 'SELECT') g[key] = e.target.value;
  else g[key] = Math.max(0, Math.round(toNum(e.target.value)));
  save();
}

function runGenerator(mode) {
  const L = active();
  const g = { ...DEFAULT_GENERATOR, ...L.generator };
  if (g.aisle < 1 || g.rackDepth < 1 || g.bayLength < 1) {
    notify('Corridoio, profondità e campata devono essere almeno 1 m.', 'error');
    return;
  }
  let target = L;
  if (mode === 'new') {
    target = {
      ...clone(L),
      id: uid('layout'),
      name: `Generato ${state.project.layouts.length + 1}`
    };
    state.project.layouts.push(target);
  }
  let locs = generateRacks(target.width, target.depth, g);
  if (locs.length === 0) {
    notify(
      'Con questi parametri non entra nessuno scaffale: riduci corridoio o fascia di testa.',
      'error'
    );
    if (mode === 'new') state.project.layouts.pop();
    return;
  }
  const qty = Math.max(1, g.qtyPerSlot);
  if (g.placement === 'catalogue') fillSkus(locs, state.project.demand, qty);
  else if (g.placement === 'random' || !g.placement)
    fillSkus(locs, state.project.demand, qty, Date.now() % 100000);
  else if (g.placement === 'abc') {
    fillSkus(locs, state.project.demand, qty);
    locs = autoSlot({ ...target, locations: locs }, state.project.demand).locations;
  }
  target.locations = locs;
  state.activeId = target.id;
  state.selected = null;
  notify(`${locs.length} ubicazioni generate in «${target.name}».`);
  changed(['layout', 'geometry', 'generator', 'settings']);
}

/* ------------------------------------------------------------------ */
/* Floor plan                                                          */
/* ------------------------------------------------------------------ */

function heatColor(t) {
  const p = Math.round(Math.max(0, Math.min(1, t)) * 100);
  return `color-mix(in oklab, var(--heat-hi) ${p}%, var(--heat-lo))`;
}

function currentResult(layoutId = active().id) {
  if (!state.run || state.run.error) return null;
  return state.run.results.find((r) => r.layoutId === layoutId) || null;
}
function currentPrep(layoutId = active().id) {
  return state.run?.preps?.find((p) => p.layout.id === layoutId) || null;
}

function routeCells(prep, seq) {
  const pts = [prep.start, ...seq.map((n) => prep.cells[n]), prep.end];
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const seg = cellPath(prep.grid, pts[i - 1], pts[i]);
    out.push(...(i === 1 ? seg : seg.slice(1)));
  }
  return out;
}

function renderMap() {
  const L = active();
  const W = L.width;
  const H = L.depth;
  const pad = 1.4;
  const res = !state.stale ? currentResult() : null;
  let maxVisits = 0;
  if (state.heat && res)
    for (const v of Object.values(res.visits)) maxVisits = Math.max(maxVisits, v);

  let grid = '';
  if (W * H <= 40000) {
    let d = '';
    for (let x = 1; x < W; x++) d += `M${x} 0V${H}`;
    for (let y = 1; y < H; y++) d += `M0 ${y}H${W}`;
    grid = `<path class="gridline" d="${d}" />`;
  }

  const locs = L.locations
    .map((loc) => {
      const f = pickFaceCell(loc);
      const empty = !loc.stock || loc.stock.length === 0;
      let style = '';
      if (state.heat && res && maxVisits > 0)
        style = ` style="fill:${heatColor((res.visits[loc.id] || 0) / maxVisits)}"`;
      const fs = Math.min(0.5, (Math.max(loc.w, loc.d) / Math.max(2, loc.id.length)) * 1.1);
      return `<g class="loc" data-loc="${esc(loc.id)}">
        <rect class="rack${loc.id === state.selected ? ' sel' : ''}${empty ? ' empty' : ''}" x="${
        loc.x
      }" y="${loc.y}" width="${loc.w}" height="${loc.d}"${style}><title>${esc(loc.id)}${
        empty ? ' (vuota)' : ': ' + esc(loc.stock.map((s) => `${s.sku} × ${s.qty}`).join(', '))
      }${res ? ` · ${res.visits[loc.id] || 0} giri` : ''}</title></rect>
        <circle class="face" cx="${f.x + 0.5}" cy="${f.y + 0.5}" r="0.13" />
        ${
          state.labels
            ? `<text class="rlabel" x="${loc.x + loc.w / 2}" y="${
                loc.y + loc.d / 2
              }" style="font-size:${fs.toFixed(2)}px">${esc(loc.id)}</text>`
            : ''
        }
      </g>`;
    })
    .join('');

  let route = '';
  const prep = res ? currentPrep() : null;
  if (res && prep && res.routes[state.routeIdx]) {
    const r = res.routes[state.routeIdx];
    const cells = routeCells(prep, r.seq);
    const pts = cells.map((c) => `${c.x + 0.5},${c.y + 0.5}`).join(' ');
    const stops = r.seq
      .map((n, i) => {
        const c = prep.cells[n];
        return `<circle class="stopdot" cx="${c.x + 0.5}" cy="${
          c.y + 0.5
        }" r="0.32" /><text class="stopnum" x="${c.x + 0.5}" y="${c.y + 0.5}">${i + 1}</text>`;
      })
      .join('');
    route = `<polyline class="route" points="${pts}" />${stops}<circle class="walker" id="walker" r="0.38" cx="-10" cy="-10" />`;
    state.routeCells = cells;
  } else state.routeCells = null;

  const s = L.start;
  const e = L.sameEnd ? L.start : L.end;
  const endMark = L.sameEnd
    ? ''
    : `<rect class="end" x="${e.x + 0.12}" y="${
        e.y + 0.12
      }" width="0.76" height="0.76"><title>Arrivo</title></rect>`;

  $('#map-wrap').className = 'map-wrap tool-' + state.tool;
  $('#map-wrap').innerHTML = `<svg id="map" viewBox="${-pad} ${-pad} ${W + 2 * pad} ${
    H + 2 * pad
  }" role="img" aria-label="Pianta del magazzino ${esc(L.name)}">
    <rect class="floor" x="0" y="0" width="${W}" height="${H}" />
    ${grid}
    <rect class="wall" x="0" y="0" width="${W}" height="${H}" />
    <text class="dim" x="${W / 2}" y="${-0.45}">${W} m</text>
    <text class="dim" x="${-0.5}" y="${H / 2}" transform="rotate(-90 ${-0.5} ${
    H / 2
  })">${H} m</text>
    ${locs}
    ${route}
    <circle class="start" cx="${s.x + 0.5}" cy="${s.y + 0.5}" r="0.45"><title>${
    L.sameEnd ? 'Partenza e arrivo' : 'Partenza'
  }</title></circle>
    ${endMark}
  </svg>`;
}

function svgPoint(evt) {
  const svg = $('#map');
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { x: p.x, y: p.y };
}

function nextLocId(L) {
  const ids = new Set(L.locations.map((l) => l.id));
  let i = L.locations.length + 1;
  while (ids.has(`U${i}`)) i++;
  return `U${i}`;
}

function onMapDown(evt) {
  if (!$('#map')) return;
  const p = svgPoint(evt);
  const L = active();
  const cx = Math.floor(p.x);
  const cy = Math.floor(p.y);
  const inside = cx >= 0 && cy >= 0 && cx < L.width && cy < L.depth;
  const g = evt.target.closest('[data-loc]');

  if (state.tool === 'select') {
    if (g) {
      state.selected = g.dataset.loc;
      const loc = selectedLoc();
      state.drag = { id: loc.id, ox: p.x, oy: p.y, dx: 0, dy: 0, el: g };
      $('#map').setPointerCapture(evt.pointerId);
      for (const r of document.querySelectorAll('#map .rack.sel')) r.classList.remove('sel');
      g.querySelector('.rack').classList.add('sel');
      renderInspector();
    } else {
      state.selected = null;
      renderMap();
      renderInspector();
    }
    return;
  }
  if (!inside) return;
  if (state.tool === 'add') {
    const loc = { id: nextLocId(L), x: cx, y: cy, w: 1, d: 2, face: 'E', stock: [] };
    loc.x = Math.min(loc.x, L.width - loc.w);
    loc.y = Math.min(loc.y, L.depth - loc.d);
    L.locations.push(loc);
    state.selected = loc.id;
  } else if (state.tool === 'start') {
    L.start = { x: cx, y: cy };
    if (L.sameEnd) L.end = { ...L.start };
  } else if (state.tool === 'end') {
    L.sameEnd = false;
    L.end = { x: cx, y: cy };
  }
  changed(['layout', 'geometry']);
}

function onMapMove(evt) {
  const d = state.drag;
  if (!d) return;
  const p = svgPoint(evt);
  const L = active();
  const loc = L.locations.find((l) => l.id === d.id);
  let dx = Math.round(p.x - d.ox);
  let dy = Math.round(p.y - d.oy);
  dx = Math.max(-loc.x, Math.min(L.width - loc.w - loc.x, dx));
  dy = Math.max(-loc.y, Math.min(L.depth - loc.d - loc.y, dy));
  if (dx !== d.dx || dy !== d.dy) {
    d.dx = dx;
    d.dy = dy;
    d.el.setAttribute('transform', `translate(${dx} ${dy})`);
  }
}

function onMapUp() {
  const d = state.drag;
  if (!d) return;
  state.drag = null;
  if (d.dx || d.dy) {
    const loc = active().locations.find((l) => l.id === d.id);
    loc.x += d.dx;
    loc.y += d.dy;
    changed(['layout']);
  }
}

function onKey(evt) {
  if (state.tab !== 'layout' || !state.selected) return;
  if (/INPUT|SELECT|TEXTAREA/.test(evt.target.tagName)) return;
  const L = active();
  const loc = selectedLoc();
  if (!loc) return;
  const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (moves[evt.key]) {
    evt.preventDefault();
    const [mx, my] = moves[evt.key];
    loc.x = Math.max(0, Math.min(L.width - loc.w, loc.x + mx));
    loc.y = Math.max(0, Math.min(L.depth - loc.d, loc.y + my));
    changed(['layout']);
  } else if (evt.key === 'Delete' || evt.key === 'Backspace') {
    evt.preventDefault();
    removeSelected();
  } else if (evt.key === 'r' || evt.key === 'R') {
    rotateSelected();
  } else if (evt.key === 'Escape') {
    state.selected = null;
    changed(['layout']);
  }
}

function removeSelected() {
  const L = active();
  L.locations = L.locations.filter((l) => l.id !== state.selected);
  state.selected = null;
  changed(['layout']);
}
function rotateSelected() {
  const loc = selectedLoc();
  if (!loc) return;
  [loc.w, loc.d] = [loc.d, loc.w];
  loc.face = { N: 'E', E: 'S', S: 'W', W: 'N' }[loc.face] || 'E';
  const L = active();
  loc.x = Math.min(loc.x, L.width - loc.w);
  loc.y = Math.min(loc.y, L.depth - loc.d);
  changed(['layout']);
}

/* ------------------------------------------------------------------ */
/* Inspector                                                           */
/* ------------------------------------------------------------------ */

function renderInspector() {
  const L = active();
  const loc = selectedLoc();
  const skuOptions = state.project.demand
    .map((d) => `<option value="${esc(d.sku)}"></option>`)
    .join('');
  if (!loc) {
    const placed = new Set();
    for (const l of L.locations) for (const s of l.stock || []) placed.add(s.sku);
    const missing = state.project.demand
      .filter((d) => d.weight > 0 && !placed.has(d.sku))
      .map((d) => d.sku);
    $('#inspector').innerHTML = `
      <h3>${esc(L.name)}</h3>
      <div class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <div class="kpi"><span class="label">Ubicazioni</span><span class="value">${
          L.locations.length
        }</span></div>
        <div class="kpi"><span class="label">SKU collocati</span><span class="value">${
          placed.size
        }</span></div>
      </div>
      ${
        missing.length
          ? `<p class="hint" style="color:var(--warn)">${
              missing.length
            } SKU del catalogo senza ubicazione: ${esc(missing.slice(0, 6).join(', '))}${
              missing.length > 6 ? '…' : ''
            }. Le loro righe non verranno evase.</p>`
          : ''
      }
      <div class="empty-state">
        <p style="margin:0">Clicca uno scaffale per modificarlo. Trascinalo per spostarlo a passi di 1 m.</p>
        <p style="margin:0">Tastiera: <span class="kbd">← → ↑ ↓</span> sposta, <span class="kbd">R</span> ruota, <span class="kbd">Canc</span> elimina, <span class="kbd">Esc</span> deseleziona.</p>
      </div>`;
    return;
  }
  const res = !state.stale ? currentResult() : null;
  const stockRows = (loc.stock || [])
    .map(
      (s, i) => `<div class="stock-row">
        <input type="text" id="st-sku-${i}" list="sku-list" data-stock="${i}" data-sf="sku" value="${esc(
        s.sku
      )}" aria-label="SKU" />
        <input type="number" id="st-qty-${i}" data-stock="${i}" data-sf="qty" value="${esc(
        s.qty
      )}" min="0" step="1" aria-label="Quantità" />
        <button type="button" class="btn small ghost danger" data-stock-del="${i}" aria-label="Rimuovi SKU">✕</button>
      </div>`
    )
    .join('');
  $('#inspector').innerHTML = `
    <div class="panel-head"><h3>Ubicazione ${esc(loc.id)}</h3>${
    res ? `<span class="tag accent">${res.visits[loc.id] || 0} giri</span>` : ''
  }</div>
    <label class="field"><span>Codice</span><input type="text" id="loc-id" data-lf="id" value="${esc(
      loc.id
    )}" /></label>
    <div class="grid">
      ${numField('X (m)', 'loc-x', loc.x, 'data-lf="x" min="0" step="1"')}
      ${numField('Y (m)', 'loc-y', loc.y, 'data-lf="y" min="0" step="1"')}
      ${numField('Larghezza (m)', 'loc-w', loc.w, 'data-lf="w" min="1" step="1"')}
      ${numField('Profondità (m)', 'loc-d', loc.d, 'data-lf="d" min="1" step="1"')}
    </div>
    <label class="field"><span>Lato di prelievo</span>
      <select id="loc-face" data-lf="face">${Object.entries(FACES)
        .map(([k, v]) => `<option value="${k}" ${loc.face === k ? 'selected' : ''}>${v}</option>`)
        .join('')}</select></label>
    <div class="field"><span>Stock in questa ubicazione</span>
      ${stockRows || '<p class="hint">Nessuno SKU: l\'ubicazione è vuota.</p>'}
      <datalist id="sku-list">${skuOptions}</datalist>
    </div>
    <div class="row">
      <button type="button" class="btn small" data-loc-act="add-stock">+ SKU</button>
      <button type="button" class="btn small" data-loc-act="rotate">Ruota 90°</button>
      <button type="button" class="btn small danger" data-loc-act="delete">Elimina ubicazione</button>
    </div>`;
}

function onInspectorChange(e) {
  const loc = selectedLoc();
  if (!loc) return;
  const L = active();
  const t = e.target;
  if (t.dataset.lf) {
    const k = t.dataset.lf;
    if (k === 'id') {
      const v = t.value.trim();
      if (!v || L.locations.some((l) => l !== loc && l.id === v)) {
        notify(
          v ? `Il codice ${v} esiste già in questo layout.` : 'Il codice non può essere vuoto.',
          'error'
        );
        t.value = loc.id;
        return;
      }
      loc.id = v;
      state.selected = v;
    } else if (k === 'face') loc.face = t.value;
    else {
      let v = Math.round(toNum(t.value));
      if (k === 'w' || k === 'd') v = Math.max(1, v);
      if (k === 'x') v = Math.max(0, Math.min(L.width - loc.w, v));
      if (k === 'y') v = Math.max(0, Math.min(L.depth - loc.d, v));
      loc[k] = v;
    }
    changed(['layout']);
  } else if (t.dataset.stock !== undefined) {
    const s = loc.stock[Number(t.dataset.stock)];
    if (t.dataset.sf === 'sku') s.sku = t.value.trim();
    else s.qty = Math.max(0, Math.round(toNum(t.value)));
    loc.stock = loc.stock.filter((x) => x.sku);
    changed(['layout']);
  }
}

function onInspectorClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  const loc = selectedLoc();
  if (!loc) return;
  if (b.dataset.stockDel !== undefined) {
    loc.stock.splice(Number(b.dataset.stockDel), 1);
    changed(['layout']);
  } else if (b.dataset.locAct === 'add-stock') {
    const used = new Set(loc.stock.map((s) => s.sku));
    const free = state.project.demand.find((d) => !used.has(d.sku));
    loc.stock.push({ sku: free ? free.sku : 'SKU-NUOVO', qty: DEFAULT_GENERATOR.qtyPerSlot });
    changed(['layout']);
  } else if (b.dataset.locAct === 'rotate') rotateSelected();
  else if (b.dataset.locAct === 'delete') removeSelected();
}

function renderIssues() {
  const L = active();
  const prep = prepareLayout(L);
  const items = [
    ...prep.errors.map((t) => `<li class="error">${esc(t)}</li>`),
    ...prep.warnings.slice(0, 6).map((t) => `<li>${esc(t)}</li>`)
  ];
  if (prep.warnings.length > 6) items.push(`<li>…e altri ${prep.warnings.length - 6} avvisi.</li>`);
  $('#layout-issues').innerHTML = items.join('');
}

/* ------------------------------------------------------------------ */
/* Sample routes                                                       */
/* ------------------------------------------------------------------ */

function renderRouteBar() {
  const el = $('#route-bar');
  const res = currentResult();
  if (!state.run || state.run.error) {
    el.innerHTML =
      '<span class="hint">Esegui una simulazione per vedere i percorsi campione su questa pianta.</span>';
    return;
  }
  if (state.stale) {
    el.innerHTML =
      '<span class="hint">Input modificati: riesegui la simulazione per aggiornare percorsi e mappa di calore.</span>';
    return;
  }
  if (!res) {
    el.innerHTML =
      '<span class="hint">Questo layout non era incluso nell\'ultima simulazione.</span>';
    return;
  }
  if (state.routeIdx >= res.routes.length) state.routeIdx = 0;
  const r = res.routes[state.routeIdx];
  el.innerHTML = `
    <label class="label" for="route-sel">Percorso campione</label>
    <select id="route-sel">${res.routes
      .map(
        (x, i) =>
          `<option value="${i}" ${i === state.routeIdx ? 'selected' : ''}>${esc(x.label)} · ${fmt(
            x.distance,
            0
          )} m</option>`
      )
      .join('')}</select>
    <button type="button" class="btn small" id="route-prev" aria-label="Percorso precedente">‹</button>
    <button type="button" class="btn small" id="route-next" aria-label="Percorso successivo">›</button>
    <button type="button" class="btn small dark" id="route-play" ${
      reducedMotion() ? 'disabled title="Animazione disattivata: movimento ridotto"' : ''
    }>${state.anim ? 'Ferma' : 'Anima'}</button>
    ${
      r
        ? `<span class="route-stops">Partenza → ${esc(r.stopsLabels.join(' → '))} → ${
            active().sameEnd ? 'ritorno' : 'arrivo'
          }</span>`
        : ''
    }`;
}

function stopAnim() {
  if (state.anim) cancelAnimationFrame(state.anim);
  state.anim = null;
}

function playRoute() {
  if (state.anim) {
    stopAnim();
    renderRouteBar();
    return;
  }
  const cells = state.routeCells;
  const walker = $('#walker');
  if (!cells || !walker || cells.length < 2) return;
  const cellsPerSec = 14;
  const t0 = performance.now();
  const step = (now) => {
    const pos = ((now - t0) / 1000) * cellsPerSec;
    const i = Math.min(cells.length - 1, Math.floor(pos));
    const j = Math.min(cells.length - 1, i + 1);
    const f = pos - i;
    walker.setAttribute('cx', cells[i].x + 0.5 + (cells[j].x - cells[i].x) * f);
    walker.setAttribute('cy', cells[i].y + 0.5 + (cells[j].y - cells[i].y) * f);
    if (pos < cells.length - 1) state.anim = requestAnimationFrame(step);
    else {
      state.anim = null;
      renderRouteBar();
    }
  };
  state.anim = requestAnimationFrame(step);
  renderRouteBar();
}

/* ------------------------------------------------------------------ */
/* Demand and history                                                  */
/* ------------------------------------------------------------------ */

function renderDemand() {
  const P = state.project;
  const L = active();
  const abc = abcClasses(P.demand);
  const total = P.demand.reduce((a, d) => a + (d.weight > 0 ? d.weight : 0), 0);
  const maxW = Math.max(1, ...P.demand.map((d) => d.weight || 0));
  const facings = new Map();
  const stock = new Map();
  for (const loc of L.locations) {
    for (const s of loc.stock || []) {
      facings.set(s.sku, (facings.get(s.sku) || 0) + 1);
      stock.set(s.sku, (stock.get(s.sku) || 0) + s.qty);
    }
  }
  const counts = { A: 0, B: 0, C: 0 };
  for (const d of P.demand) counts[abc[d.sku]]++;
  const rows = P.demand
    .map((d, i) => {
      const prob = total > 0 && d.weight > 0 ? (100 * d.weight) / total : 0;
      const f = facings.get(d.sku) || 0;
      return `<tr>
        <td><input type="text" id="dm-sku-${i}" data-dm="${i}" data-df="sku" value="${esc(
        d.sku
      )}" aria-label="SKU" /></td>
        <td><input type="number" id="dm-w-${i}" data-dm="${i}" data-df="weight" value="${esc(
        d.weight
      )}" min="0" step="1" aria-label="Peso" /></td>
        <td class="n"><span class="pbar" style="width:${Math.round(
          (48 * (d.weight || 0)) / maxW
        )}px"></span>${fmt(prob, 2)} %</td>
        <td><span class="abc abc-${abc[d.sku]}">${abc[d.sku]}</span></td>
        <td class="n${f === 0 && d.weight > 0 ? ' neg' : ''}">${f}</td>
        <td class="n">${stock.get(d.sku) || 0}</td>
        <td><button type="button" class="btn small ghost danger" data-dm-del="${i}" aria-label="Rimuovi ${esc(
        d.sku
      )}">✕</button></td>
      </tr>`;
    })
    .join('');
  $('#demand').innerHTML = `
    <div class="panel-head">
      <h3>Catalogo domanda</h3>
      <div class="row">
        <button type="button" class="btn small" data-dm-act="sort">Ordina per peso</button>
        <button type="button" class="btn small" data-dm-act="add">+ SKU</button>
      </div>
    </div>
    <p class="hint">Il peso è la frequenza relativa con cui uno SKU compare nelle righe d'ordine (non lo stock). Usa le righe prelevate in un periodo rappresentativo. Il catalogo è comune a tutti i layout. Peso 0 esclude lo SKU.</p>
    <p class="hint"><b>${P.demand.length}</b> SKU · classe A: <b>${
    counts.A
  }</b> SKU fanno l'80 % delle righe · B: ${counts.B} · C: ${
    counts.C
  }. Ubicazioni e stock si riferiscono a «${esc(L.name)}».</p>
    <div class="table-wrap">
      <table class="demand-table">
        <thead><tr><th>SKU</th><th>Peso</th><th class="n">Probabilità</th><th>ABC</th><th class="n">Ubicazioni</th><th class="n">Stock</th><th></th></tr></thead>
        <tbody>${
          rows ||
          '<tr><td colspan="7" class="hint">Catalogo vuoto. Aggiungi SKU o importa un CSV.</td></tr>'
        }</tbody>
      </table>
    </div>
    <div class="fieldset">
      <h4>Importa pesi da CSV</h4>
      <p class="hint">Colonne <span class="mono">SKU</span> e <span class="mono">Weight</span> (anche <span class="mono">Peso</span>). Virgola o punto e virgola. Gli SKU esistenti vengono aggiornati, i nuovi aggiunti. Il file resta nel browser.</p>
      <pre class="code">SKU;Weight
SKU-001;420
SKU-002;180</pre>
      <div class="row">
        <label class="btn small dark file-btn" for="file-demand">Scegli file CSV</label>
        <input type="file" id="file-demand" accept=".csv,text/csv,text/plain" hidden />
      </div>
    </div>`;
}

function onDemandChange(e) {
  const t = e.target;
  if (t.dataset.dm === undefined) return;
  const d = state.project.demand[Number(t.dataset.dm)];
  if (t.dataset.df === 'sku') {
    const v = t.value.trim();
    if (!v || state.project.demand.some((x) => x !== d && x.sku === v)) {
      notify(v ? `${v} è già nel catalogo.` : 'Lo SKU non può essere vuoto.', 'error');
      t.value = d.sku;
      return;
    }
    // Keep placements consistent when renaming.
    for (const L of state.project.layouts)
      for (const loc of L.locations)
        for (const s of loc.stock || []) if (s.sku === d.sku) s.sku = v;
    d.sku = v;
  } else d.weight = Math.max(0, toNum(t.value));
  changed(['demand', 'layout']);
}

function onDemandClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  const P = state.project;
  if (b.dataset.dmDel !== undefined) {
    P.demand.splice(Number(b.dataset.dmDel), 1);
  } else if (b.dataset.dmAct === 'add') {
    const ids = new Set(P.demand.map((d) => d.sku));
    let i = P.demand.length + 1;
    while (ids.has(`SKU-${String(i).padStart(3, '0')}`)) i++;
    P.demand.push({ sku: `SKU-${String(i).padStart(3, '0')}`, weight: 10 });
  } else if (b.dataset.dmAct === 'sort') {
    P.demand.sort((a, c) => c.weight - a.weight || naturalCompare(a.sku, c.sku));
  } else return;
  changed(['demand', 'layout']);
}

function mergeDemand(rows) {
  const P = state.project;
  const bySku = new Map(P.demand.map((d) => [d.sku, d]));
  let added = 0;
  let updated = 0;
  for (const r of rows) {
    if (bySku.has(r.sku)) {
      bySku.get(r.sku).weight = r.weight;
      updated++;
    } else {
      const d = { sku: r.sku, weight: r.weight };
      P.demand.push(d);
      bySku.set(r.sku, d);
      added++;
    }
  }
  return { added, updated };
}

function renderHistory() {
  const H = state.project.history || [];
  let summary = '';
  if (H.length) {
    const lines = H.reduce((a, o) => a + o.lines.length, 0);
    const skus = new Set();
    for (const o of H) for (const l of o.lines) skus.add(l.sku);
    const catalog = new Set(state.project.demand.map((d) => d.sku));
    const unknown = [...skus].filter((s) => !catalog.has(s));
    summary = `
      <div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        <div class="kpi"><span class="label">Ordini</span><span class="value">${H.length.toLocaleString(
          'it-IT'
        )}</span></div>
        <div class="kpi"><span class="label">Righe/ordine</span><span class="value">${fmt(
          lines / H.length,
          2
        )}</span></div>
        <div class="kpi"><span class="label">SKU</span><span class="value">${skus.size}</span></div>
      </div>
      ${
        unknown.length
          ? `<p class="hint" style="color:var(--warn)">${unknown.length} SKU della storia non sono nel catalogo: aggiorna i pesi dalla storia per aggiungerli.</p>`
          : ''
      }
      <div class="row">
        <button type="button" class="btn small dark" data-h-act="weights">Aggiorna i pesi dalla storia</button>
        <button type="button" class="btn small" data-h-act="use">Simula con questi ordini</button>
        <button type="button" class="btn small danger" data-h-act="clear">Rimuovi storia</button>
      </div>`;
  }
  $('#history').innerHTML = `
    <h3>Ordini storici</h3>
    <p class="hint">Gli ordini reali conservano quali SKU escono insieme, cosa che i pesi da soli perdono. È il dato che rende credibile un progetto di slotting. Una riga per riga d'ordine.</p>
    <pre class="code">OrderID;SKU;Qty
100231;SKU-001;2
100231;SKU-014;1
100232;SKU-003;4</pre>
    <div class="row">
      <label class="btn small dark file-btn" for="file-orders">Scegli file CSV</label>
      <input type="file" id="file-orders" accept=".csv,text/csv,text/plain" hidden />
    </div>
    <label class="field"><span>…oppure incolla le righe</span>
      <textarea id="orders-paste" rows="4" placeholder="OrderID;SKU;Qty"></textarea></label>
    <div class="row"><button type="button" class="btn small" data-h-act="paste">Importa testo incollato</button></div>
    ${summary}`;
}

function importHistory(text) {
  const orders = parseOrdersCsv(text);
  if (orders.length === 0) {
    notify(
      'Nessuna riga valida trovata. Servono le colonne OrderID, SKU e (facoltativa) Qty.',
      'error'
    );
    return;
  }
  state.project.history = orders;
  state.project.settings.source = 'history';
  notify(`${orders.length} ordini importati. La simulazione userà gli ordini storici.`);
  changed(['demand', 'settings']);
}

function onHistoryClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  const P = state.project;
  const act = b.dataset.hAct;
  if (act === 'paste') importHistory($('#orders-paste').value);
  else if (act === 'clear') {
    P.history = [];
    P.settings.source = 'random';
    changed(['demand', 'settings']);
  } else if (act === 'weights') {
    const { added, updated } = mergeDemand(demandFromHistory(P.history));
    notify(
      `Pesi aggiornati: ${updated} SKU aggiornati, ${added} aggiunti. I nuovi SKU vanno assegnati a un'ubicazione.`
    );
    changed(['demand', 'layout']);
  } else if (act === 'use') {
    P.settings.source = 'history';
    changed(['settings']);
    setTab('sim');
  }
}

/* ------------------------------------------------------------------ */
/* Settings and run                                                    */
/* ------------------------------------------------------------------ */

function renderSettings() {
  const s = state.project.settings;
  const H = state.project.history || [];
  const inc = state.project.layouts.filter((l) => l.include !== false);
  const sf = (label, key, attrs, hint = '') =>
    numField(label, 's-' + key, s[key], `data-s="${key}" ${attrs}`, hint);
  $('#settings').innerHTML = `
    <div class="panel-head"><h3>Parametri di simulazione</h3><span class="hint">Valgono per tutti i layout confrontati.</span></div>
    <div class="fieldset">
      <h4>Ordini</h4>
      <div class="grid">
        <label class="field"><span>Origine</span>
          <select id="s-source" data-s="source">
            <option value="random" ${
              s.source !== 'history' ? 'selected' : ''
            }>Casuali dai pesi</option>
            <option value="history" ${s.source === 'history' ? 'selected' : ''} ${
    H.length ? '' : 'disabled'
  }>Storici (${H.length.toLocaleString('it-IT')})</option>
          </select></label>
        ${sf('Numero ordini', 'orders', 'min="100" max="50000" step="100"')}
        ${sf(
          'Righe per ordine',
          'linesPerOrder',
          'min="1" max="40" step="1"',
          'Media se variabile'
        )}
        ${sf('Pezzi max per riga', 'maxUnitsPerLine', 'min="1" max="50" step="1"')}
        ${sf('Seed', 'seed', 'step="1"', 'Stesso seed, stessi ordini')}
      </div>
      <div class="row">
        <label class="check"><input type="checkbox" id="s-var" data-s="variableLines" ${
          s.variableLines ? 'checked' : ''
        } /> Righe variabili (da 1 a 2 × media − 1)</label>
        <label class="check"><input type="checkbox" id="s-rob" data-s="robustness" ${
          s.robustness ? 'checked' : ''
        } /> Verifica con altri 4 seed</label>
      </div>
    </div>
    <div class="fieldset">
      <h4>Operatore e metodo di prelievo</h4>
      <div class="grid">
        ${sf(
          'Velocità (m/s)',
          'speed',
          'min="0.2" max="4" step="0.1"',
          'A piedi con carrello ≈ 1,0–1,2'
        )}
        ${sf('Tempo per riga (s)', 'timePerLine', 'min="0" step="1"', 'Trova, scansiona, conferma')}
        ${sf('Tempo per pezzo (s)', 'timePerUnit', 'min="0" step="0.5"')}
        ${sf(
          'Preparazione giro (s)',
          'setupPerTour',
          'min="0" step="5"',
          'Lista, carrello, consegna'
        )}
        ${sf(
          'Ordini per giro',
          'batchSize',
          'min="1" max="20" step="1"',
          '1 = prelievo per ordine'
        )}
        ${sf('Smistamento per riga (s)', 'sortPerLine', 'min="0" step="0.5"', 'Solo con batch > 1')}
        <label class="field"><span>Sequenza di visita</span>
          <select id="s-seq" data-s="sequence">${Object.entries(SEQUENCE_MODES)
            .map(
              ([k, v]) => `<option value="${k}" ${s.sequence === k ? 'selected' : ''}>${v}</option>`
            )
            .join('')}</select></label>
      </div>
    </div>
    <div class="fieldset">
      <h4>Economia</h4>
      <div class="grid">
        ${sf('Ordini al giorno', 'dailyOrders', 'min="1" step="50"')}
        ${sf(
          'Costo orario (€)',
          'hourlyCost',
          'min="0" step="0.5"',
          'Costo pieno per ora operatore'
        )}
        ${sf('Ore per turno', 'shiftHours', 'min="1" max="12" step="0.5"')}
        ${sf('Giorni lavorativi/anno', 'workingDays', 'min="1" max="366" step="1"')}
        ${numField(
          'Utilizzo (%)',
          's-util',
          Math.round(s.utilisation * 100),
          'data-s="utilisation" min="30" max="100" step="1"',
          'Tempo produttivo sul turno'
        )}
      </div>
    </div>
    <div class="fieldset">
      <p class="hint">Confronto su <b>${inc.length}</b> layout: ${
    inc
      .map((l, i) => `${i === 0 ? '<b>' : ''}${esc(l.name)}${i === 0 ? '</b> (baseline)' : ''}`)
      .join(', ') || 'nessuno'
  }. Scegli quali includere dalle schede in cima al passo 1.</p>
      <div class="run-row">
        <button type="button" class="btn primary" id="btn-run">Esegui simulazione</button>
        <span class="hint" id="run-status"></span>
      </div>
    </div>`;
}

function onSettingsChange(e) {
  const k = e.target.dataset.s;
  if (!k) return;
  const s = state.project.settings;
  if (e.target.type === 'checkbox') s[k] = e.target.checked;
  else if (e.target.tagName === 'SELECT') s[k] = e.target.value;
  else if (k === 'utilisation') s[k] = Math.min(1, Math.max(0.3, toNum(e.target.value, 85) / 100));
  else {
    const v = toNum(e.target.value, DEFAULT_SETTINGS[k]);
    const ints = [
      'orders',
      'linesPerOrder',
      'maxUnitsPerLine',
      'seed',
      'batchSize',
      'dailyOrders',
      'workingDays'
    ];
    s[k] = ints.includes(k) ? Math.round(v) : v;
    if (k === 'orders') s[k] = Math.min(50000, Math.max(100, s[k]));
    if (k === 'speed') s[k] = Math.max(0.2, s[k]);
    if (['linesPerOrder', 'maxUnitsPerLine', 'batchSize'].includes(k)) s[k] = Math.max(1, s[k]);
  }
  if (state.run) state.stale = true;
  save();
  renderSteps();
  renderResults();
}

function runSimulation({ quiet = false } = {}) {
  const status = $('#run-status');
  if (status) status.textContent = 'Calcolo in corso…';
  const btn = $('#btn-run');
  if (btn) btn.disabled = true;
  setTimeout(() => {
    const t0 = performance.now();
    const run = simulate(state.project);
    const ms = performance.now() - t0;
    state.run = run;
    state.stale = false;
    state.routeIdx = 0;
    state.visitsLayout = null;
    if (btn) btn.disabled = false;
    if (status)
      status.textContent = run.error ? run.error : `Completata in ${fmt(ms / 1000, 1)} s.`;
    renderSteps();
    renderResults();
    renderMap();
    renderRouteBar();
    renderInspector();
    if (!quiet) {
      setTab('results');
      if (run.error) notify(run.error, 'error');
    }
  }, 30);
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

// Horizontal bar chart in SVG. rows: [{label, parts:[{v, cls}], note}]
function hbar(rows, { unit = '', digits = 1, title = '' } = {}) {
  const W = 640;
  const lw = 210;
  const rh = 32;
  const top = 6;
  const H = top + rows.length * rh + 22;
  const max = Math.max(1e-9, ...rows.map((r) => r.parts.reduce((a, p) => a + p.v, 0)));
  const sc = (W - lw - 90) / max;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  let out = ticks
    .map(
      (t) =>
        `<line class="axis" x1="${lw + t * sc}" x2="${lw + t * sc}" y1="${top}" y2="${
          top + rows.length * rh
        }" /><text class="v m" x="${lw + t * sc}" y="${H - 6}" text-anchor="middle">${fmt(
          t,
          t < 10 ? 1 : 0
        )}</text>`
    )
    .join('');
  rows.forEach((r, i) => {
    const y = top + i * rh;
    const label = r.label.length > 30 ? r.label.slice(0, 29) + '…' : r.label;
    out += `<text x="${lw - 10}" y="${y + rh / 2 + 4}" text-anchor="end"><title>${esc(
      r.label
    )}</title>${esc(label)}</text>`;
    let x = lw;
    for (const p of r.parts) {
      const w = Math.max(0, p.v * sc);
      out += `<rect class="${p.cls}" x="${x}" y="${y + 6}" width="${w}" height="${
        rh - 12
      }" rx="2" />`;
      x += w;
    }
    const total = r.parts.reduce((a, p) => a + p.v, 0);
    out += `<text class="v" x="${x + 6}" y="${y + rh / 2 + 4}">${fmt(total, digits)}${unit}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${out}</svg>`;
}

function renderResults() {
  const el = $('#results');
  const run = state.run;
  if (!run) {
    el.innerHTML = `<div class="verdict"><h2>Nessuna simulazione ancora eseguita</h2><p>Imposta layout, domanda e parametri, poi esegui la simulazione.</p><div><button type="button" class="btn primary" data-res-act="run">Esegui simulazione</button></div></div>`;
    return;
  }
  if (run.error) {
    el.innerHTML = `<div class="verdict stale"><h2>${esc(run.error)}</h2>${
      run.issues?.length
        ? `<ul class="issues">${run.issues
            .map((i) => `<li class="${i.level}">${esc(i.layout)}: ${esc(i.text)}</li>`)
            .join('')}</ul>`
        : ''
    }</div>`;
    return;
  }
  const s = run.settings;
  const R = run.results;
  const base = R[0];
  const best = R.reduce((a, r) => (r.avgTime < a.avgTime ? r : a), R[0]);
  const bestIsBase = best === base;
  const robust = best.timeGainMin !== undefined;
  const fragile = robust && !bestIsBase && best.timeGainMin <= 0;
  const srcText =
    run.source === 'history'
      ? `${run.ordersCount.toLocaleString('it-IT')} ordini storici`
      : `${run.ordersCount.toLocaleString('it-IT')} ordini casuali (seed ${s.seed})`;
  const method = `${SEQUENCE_MODES[s.sequence]}, ${
    s.batchSize > 1 ? `${s.batchSize} ordini per giro` : 'un ordine per giro'
  }`;

  const headline =
    R.length === 1
      ? `«${esc(base.name)}»: ${fmt(base.avgTime, 0)} s e ${fmt(base.avgDistance, 1)} m per ordine`
      : bestIsBase
      ? `Nessuna alternativa batte la baseline «${esc(base.name)}»`
      : `«${esc(best.name)}» riduce il tempo per ordine del ${fmt(
          best.timeGain,
          1
        )} % rispetto a «${esc(base.name)}»`;

  const verdictText = [
    `Su ${srcText}, ${method.toLowerCase()}.`,
    !bestIsBase && R.length > 1
      ? `A ${s.dailyOrders.toLocaleString('it-IT')} ordini/giorno vale circa ${eur(
          best.annualSaving
        )} l'anno (${fmt(base.fte - best.fte, 2)} FTE).`
      : '',
    robust && !bestIsBase
      ? fragile
        ? `Attenzione: con altri seed il guadagno scende fino a ${fmt(
            best.timeGainMin,
            1
          )} %. Il vantaggio non è robusto.`
        : `Con altri 4 seed il guadagno resta tra ${fmt(best.timeGainMin, 1)} % e ${fmt(
            best.timeGainMax,
            1
          )} %.`
      : ''
  ]
    .filter(Boolean)
    .join(' ');

  const tableRows = R.map(
    (r) => `<tr>
      <td>${esc(r.name)} ${r === base ? '<span class="tag">Baseline</span>' : ''}${
      r === best && !bestIsBase ? ' <span class="tag accent">Migliore</span>' : ''
    }</td>
      <td class="n">${fmt(r.avgDistance)}</td>
      <td class="n">${fmt(r.p95Distance)}</td>
      <td class="n">${fmt(r.avgTravelTime)}</td>
      <td class="n">${fmt(r.avgHandlingTime)}</td>
      <td class="n"><b>${fmt(r.avgTime)}</b></td>
      <td class="n">${fmt(r.ordersPerHour)}</td>
      <td class="n">${fmt(r.fte, 2)}</td>
      <td class="n">${eur(r.costPerOrder, 2)}</td>
      <td class="n">${eur(r.annualCost)}</td>
      <td class="n ${r.distanceGain > 0 ? 'pos' : r.distanceGain < 0 ? 'neg' : ''}">${
      r === base ? '–' : signed(r.distanceGain) + ' %'
    }</td>
      <td class="n ${r.timeGain > 0 ? 'pos' : r.timeGain < 0 ? 'neg' : ''}">${
      r === base ? '–' : signed(r.timeGain) + ' %'
    }${
      r !== base && r.timeGainMin !== undefined
        ? `<span class="range">${fmt(r.timeGainMin, 1)} … ${fmt(r.timeGainMax, 1)}</span>`
        : ''
    }</td>
    </tr>`
  ).join('');

  const cls = (r) => (r === base ? 'bar base' : r === best ? 'bar best' : 'bar');
  const distChart = hbar(
    R.map((r) => ({ label: r.name, parts: [{ v: r.avgDistance, cls: cls(r) }] })),
    { unit: ' m', title: 'Distanza media per ordine' }
  );
  const timeChart = hbar(
    R.map((r) => ({
      label: r.name,
      parts: [
        { v: r.avgTravelTime, cls: 'bar' },
        { v: r.avgHandlingTime, cls: 'bar2' }
      ]
    })),
    { unit: ' s', digits: 0, title: 'Tempo medio per ordine' }
  );

  const vId =
    state.visitsLayout && R.some((r) => r.layoutId === state.visitsLayout)
      ? state.visitsLayout
      : best.layoutId;
  const vr = R.find((r) => r.layoutId === vId);
  const visits = Object.entries(vr.visits).sort((a, b) => b[1] - a[1]);
  const totalVisits = visits.reduce((a, [, v]) => a + v, 0);
  const top20 = visits
    .slice(0, Math.max(1, Math.ceil(visits.length * 0.2)))
    .reduce((a, [, v]) => a + v, 0);
  const visitChart = hbar(
    visits.slice(0, 15).map(([id, v]) => ({ label: id, parts: [{ v, cls: 'bar' }] })),
    { digits: 0, title: 'Ubicazioni più visitate' }
  );

  const issues = run.issues.length
    ? `<ul class="issues">${run.issues
        .map((i) => `<li class="${i.level}">${esc(i.layout)}: ${esc(i.text)}</li>`)
        .join('')}</ul>`
    : '';

  el.innerHTML = `<div class="results">
    <div class="verdict${state.stale ? ' stale' : ''}">
      ${
        state.stale
          ? '<p style="color:var(--warn)"><b>Input modificati dopo questa simulazione.</b> I numeri sotto si riferiscono alla versione precedente.</p>'
          : ''
      }
      <h2>${headline}</h2>
      <p>${verdictText}</p>
      <div class="row">
        <button type="button" class="btn primary" data-res-act="run">${
          state.stale ? 'Riesegui simulazione' : 'Esegui di nuovo'
        }</button>
        <button type="button" class="btn" data-res-act="csv">Esporta risultati CSV</button>
        <button type="button" class="btn" data-res-act="json">Esporta risultati JSON</button>
      </div>
    </div>
    <div class="kpis">
      <div class="kpi"><span class="label">Tempo per ordine · migliore</span><span class="value">${fmt(
        best.avgTime,
        0
      )} s</span><span class="sub">${
    R.length > 1 ? `baseline ${fmt(base.avgTime, 0)} s` : esc(best.name)
  }</span></div>
      <div class="kpi"><span class="label">Distanza per ordine · migliore</span><span class="value">${fmt(
        best.avgDistance,
        1
      )} m</span><span class="sub">${
    R.length > 1 ? `baseline ${fmt(base.avgDistance, 1)} m` : `P95 ${fmt(best.p95Distance, 0)} m`
  }</span></div>
      <div class="kpi"><span class="label">Ordini per ora operatore</span><span class="value">${fmt(
        best.ordersPerHour,
        1
      )}</span><span class="sub">con utilizzo ${Math.round(s.utilisation * 100)} %</span></div>
      <div class="kpi"><span class="label">Operatori necessari</span><span class="value">${fmt(
        best.fte,
        2
      )}</span><span class="sub">${
    R.length > 1 ? `baseline ${fmt(base.fte, 2)} FTE` : `${s.dailyOrders} ordini/giorno`
  }</span></div>
      ${
        R.length > 1
          ? `<div class="kpi"><span class="label">Risparmio annuo stimato</span><span class="value ${
              best.annualSaving > 0 ? 'pos' : ''
            }">${eur(
              best.annualSaving
            )}</span><span class="sub">solo manodopera di prelievo</span></div>`
          : ''
      }
    </div>
    <div class="panel">
      <h3>Confronto per layout</h3>
      <p class="hint">Valori medi per ordine. Δ positivo = migliore della baseline; sotto il Δ tempo, l'intervallo ottenuto con altri seed.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Layout</th><th class="n">Dist. m</th><th class="n">P95 m</th><th class="n">Viaggio s</th><th class="n">Prelievo s</th><th class="n">Totale s</th><th class="n">Ordini/h</th><th class="n">FTE</th><th class="n">€/ordine</th><th class="n">Costo annuo</th><th class="n">Δ dist.</th><th class="n">Δ tempo</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table></div>
    </div>
    <div class="charts">
      <div class="panel chart"><h3>Distanza media per ordine</h3>${distChart}<p class="hint">Grigio = baseline, giallo = migliore.</p></div>
      <div class="panel chart"><h3>Tempo medio per ordine</h3>${timeChart}<p class="hint">Blu pieno = cammino, chiaro = prelievo e smistamento. Se il prelievo domina, il layout conta poco: lavora su processo e imballi.</p></div>
    </div>
    <div class="panel chart">
      <div class="panel-head"><h3>Ubicazioni più visitate</h3>
        <select id="visits-layout" style="width:auto;max-width:100%">${R.map(
          (r) =>
            `<option value="${esc(r.layoutId)}" ${r.layoutId === vId ? 'selected' : ''}>${esc(
              r.name
            )}</option>`
        ).join('')}</select>
      </div>
      <p class="hint">Il 20 % delle ubicazioni più visitate riceve il <b>${fmt(
        totalVisits ? (100 * top20) / totalVisits : 0,
        0
      )} %</b> delle visite. Controlla che stiano vicino alla partenza: attiva la mappa di calore nel passo 1.</p>
      ${visitChart}
    </div>
    ${issues}
  </div>`;
}

function resultsCsv() {
  const R = state.run.results;
  const head = [
    'Layout',
    'Ordini',
    'Giri',
    'DistanzaMedia_m',
    'DistanzaP95_m',
    'Viaggio_s',
    'Prelievo_s',
    'Totale_s',
    'OrdiniOra',
    'FTE',
    'EuroOrdine',
    'CostoAnnuo',
    'DeltaDistanza_pct',
    'DeltaTempo_pct',
    'RigheNonEvase'
  ];
  const rows = R.map((r) =>
    [
      r.name,
      r.orders,
      r.tours,
      r.avgDistance,
      r.p95Distance,
      r.avgTravelTime,
      r.avgHandlingTime,
      r.avgTime,
      r.ordersPerHour,
      r.fte,
      r.costPerOrder,
      r.annualCost,
      r.distanceGain,
      r.timeGain,
      r.shortLines
    ]
      .map((v) =>
        typeof v === 'number'
          ? v.toFixed(3).replace('.', ',')
          : `"${String(v).replace(/"/g, '""')}"`
      )
      .join(';')
  );
  return [head.join(';'), ...rows].join('\n');
}

function resultsJson() {
  const run = state.run;
  return JSON.stringify(
    {
      generated: new Date().toISOString(),
      settings: run.settings,
      ordersCount: run.ordersCount,
      source: run.source,
      results: run.results.map(({ routes, ...r }) => ({
        ...r,
        sampleRoutes: routes.map((x) => ({
          label: x.label,
          stops: x.stopsLabels,
          distance: x.distance
        }))
      })),
      issues: run.issues
    },
    null,
    2
  );
}

/* ------------------------------------------------------------------ */
/* Export modal and files                                              */
/* ------------------------------------------------------------------ */

function showExport(title, text, filename, mime) {
  $('#modal-title').textContent = title;
  $(
    '#modal-text'
  ).textContent = `Copia il contenuto oppure scaricalo come ${filename}. Se il download non parte in questa vista, usa Copia e incolla in un file.`;
  $('#modal-area').value = text;
  $('#modal').hidden = false;
  $('#modal-download').onclick = () => {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: mime }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      notify('Download non disponibile qui: usa Copia.', 'error');
    }
  };
  $('#modal-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      $('#modal-copy').textContent = 'Copiato';
      setTimeout(() => ($('#modal-copy').textContent = 'Copia'), 1500);
    } catch {
      $('#modal-area').focus();
      $('#modal-area').select();
      notify('Copia automatica non disponibile: il testo è selezionato, usa Ctrl/Cmd + C.');
    }
  };
  $('#modal-close').focus();
}

function readFile(input, cb) {
  const f = input.files?.[0];
  if (!f) return;
  if (f.size > 20 * 1024 * 1024) {
    notify('File troppo grande (massimo 20 MB).', 'error');
    input.value = '';
    return;
  }
  const r = new FileReader();
  r.onload = () => {
    cb(String(r.result));
    input.value = '';
  };
  r.onerror = () => notify('Impossibile leggere il file.', 'error');
  r.readAsText(f);
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

function loadProject(p, message) {
  state.project = p;
  state.activeId = p.layouts[0].id;
  state.selected = null;
  state.run = null;
  state.stale = false;
  save();
  renderAll();
  if (message) notify(message);
  runSimulation({ quiet: true });
}

function renderAll() {
  renderSteps();
  renderLayoutList();
  renderGeometry();
  renderGenerator();
  renderMap();
  renderInspector();
  renderRouteBar();
  renderIssues();
  renderDemand();
  renderHistory();
  renderSettings();
  renderResults();
}

function wire() {
  $('#steps').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) setTab(b.dataset.tab);
  });

  $('#btn-sample').addEventListener('click', () => {
    // Two-step confirmation: the browser's confirm() is not available everywhere.
    if (!state.pendingSample) {
      state.pendingSample = true;
      notify(
        'Il progetto attuale verrà sostituito. Premi di nuovo "Carica esempio" per confermare (esporta prima se vuoi conservarlo).'
      );
      setTimeout(() => (state.pendingSample = false), 5000);
      return;
    }
    state.pendingSample = false;
    loadProject(sampleProject(), 'Esempio caricato: dati illustrativi, non reali.');
  });
  $('#btn-export').addEventListener('click', () =>
    showExport(
      'Esporta progetto',
      JSON.stringify(state.project, null, 2),
      'pick-path-lab-progetto.json',
      'application/json'
    )
  );
  $('#file-project').addEventListener('change', (e) =>
    readFile(e.target, (text) => {
      try {
        loadProject(
          normalizeProject(JSON.parse(text)),
          'Progetto importato. Nessun dato è stato inviato.'
        );
      } catch (err) {
        notify('Progetto non valido: ' + err.message, 'error');
      }
    })
  );

  // Layout list
  $('#layout-list').addEventListener('click', (e) => {
    const inc = e.target.closest('[data-include]');
    if (inc) {
      const L = state.project.layouts.find((l) => l.id === inc.dataset.include);
      L.include = inc.checked;
      changed(['layout', 'settings']);
      return;
    }
    const act = e.target.closest('[data-act]');
    if (act) return layoutAction(act.dataset.act);
    const card = e.target.closest('[data-layout]');
    if (card && card.dataset.layout !== state.activeId) {
      state.activeId = card.dataset.layout;
      state.selected = null;
      stopAnim();
      renderAll();
    }
  });
  $('#layout-list').addEventListener('keydown', (e) => {
    const card = e.target.closest('[data-layout]');
    if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      card.click();
    }
  });

  // Toolbar
  document.querySelector('.seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tool]');
    if (!b) return;
    state.tool = b.dataset.tool;
    for (const x of document.querySelectorAll('.seg [data-tool]'))
      x.classList.toggle('active', x === b);
    $('#map-wrap').className = 'map-wrap tool-' + state.tool;
  });
  $('#chk-heat').addEventListener('change', (e) => {
    state.heat = e.target.checked;
    if (state.heat && (!state.run || state.stale))
      notify("La mappa di calore usa l'ultima simulazione: eseguila per vedere i colori.");
    renderMap();
  });
  $('#chk-labels').addEventListener('change', (e) => {
    state.labels = e.target.checked;
    renderMap();
  });

  // Map
  const mw = $('#map-wrap');
  mw.addEventListener('pointerdown', onMapDown);
  mw.addEventListener('pointermove', onMapMove);
  mw.addEventListener('pointerup', onMapUp);
  mw.addEventListener('pointercancel', onMapUp);
  document.addEventListener('keydown', onKey);

  // Panels
  $('#geometry').addEventListener('change', onGeometryChange);
  $('#generator').addEventListener('change', onGeneratorChange);
  $('#generator').addEventListener('click', (e) => {
    const b = e.target.closest('[data-gen-act]');
    if (b) runGenerator(b.dataset.genAct);
  });
  $('#inspector').addEventListener('change', onInspectorChange);
  $('#inspector').addEventListener('click', onInspectorClick);

  $('#route-bar').addEventListener('change', (e) => {
    if (e.target.id === 'route-sel') {
      stopAnim();
      state.routeIdx = Number(e.target.value);
      renderMap();
      renderRouteBar();
    }
  });
  $('#route-bar').addEventListener('click', (e) => {
    const res = currentResult();
    if (!res) return;
    if (e.target.id === 'route-play') return playRoute();
    const dir = e.target.id === 'route-next' ? 1 : e.target.id === 'route-prev' ? -1 : 0;
    if (!dir) return;
    stopAnim();
    state.routeIdx = (state.routeIdx + dir + res.routes.length) % res.routes.length;
    renderMap();
    renderRouteBar();
  });

  $('#demand').addEventListener('change', (e) => {
    if (e.target.id === 'file-demand') {
      readFile(e.target, (text) => {
        const rows = parseDemandCsv(text);
        if (!rows.length)
          return notify('Nessuna riga valida. Servono le colonne SKU e Weight.', 'error');
        const { added, updated } = mergeDemand(rows);
        notify(`Catalogo aggiornato: ${updated} SKU aggiornati, ${added} aggiunti.`);
        changed(['demand', 'layout']);
      });
      return;
    }
    onDemandChange(e);
  });
  $('#demand').addEventListener('click', onDemandClick);
  $('#history').addEventListener('change', (e) => {
    if (e.target.id === 'file-orders') readFile(e.target, importHistory);
  });
  $('#history').addEventListener('click', onHistoryClick);

  $('#settings').addEventListener('change', onSettingsChange);
  $('#settings').addEventListener('click', (e) => {
    if (e.target.id === 'btn-run') runSimulation();
  });

  $('#results').addEventListener('click', (e) => {
    const b = e.target.closest('[data-res-act]');
    if (!b) return;
    const act = b.dataset.resAct;
    if (act === 'run') runSimulation();
    else if (act === 'csv')
      showExport('Risultati CSV', resultsCsv(), 'pick-path-lab-risultati.csv', 'text/csv');
    else if (act === 'json')
      showExport(
        'Risultati JSON',
        resultsJson(),
        'pick-path-lab-risultati.json',
        'application/json'
      );
  });
  $('#results').addEventListener('change', (e) => {
    if (e.target.id === 'visits-layout') {
      state.visitsLayout = e.target.value;
      renderResults();
    }
  });

  $('#modal-close').addEventListener('click', () => ($('#modal').hidden = true));
  $('#modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') $('#modal').hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal').hidden) $('#modal').hidden = true;
  });
}

function start() {
  wire();
  let p = null;
  const saved = loadSaved();
  if (saved) {
    try {
      p = normalizeProject(saved);
    } catch {
      p = null;
    }
  }
  loadProject(p || sampleProject());
}

start();
