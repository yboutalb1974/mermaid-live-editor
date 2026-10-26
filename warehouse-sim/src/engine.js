// Pick Path Lab — simulation engine.
// Pure functions only (no DOM), so the same code runs in the browser and in Node tests.
// Geometry uses a 1 m grid. x grows to the right, y grows downwards, (0,0) is the top-left corner.

export const ENGINE_VERSION = 1;

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export function rowLetter(index) {
  let s = '';
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function mean(values) {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export function uid(prefix = 'id') {
  return prefix + '-' + Math.random().toString(36).slice(2, 9);
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/* ------------------------------------------------------------------ */
/* Grid and shortest paths                                             */
/* ------------------------------------------------------------------ */

export function buildGrid(layout) {
  const W = Math.max(1, Math.round(layout.width));
  const H = Math.max(1, Math.round(layout.depth));
  const blocked = new Uint8Array(W * H);
  for (const loc of layout.locations) {
    for (let y = loc.y; y < loc.y + loc.d; y++) {
      if (y < 0 || y >= H) continue;
      for (let x = loc.x; x < loc.x + loc.w; x++) {
        if (x < 0 || x >= W) continue;
        blocked[y * W + x] = 1;
      }
    }
  }
  return { W, H, blocked };
}

export function isWalkable(grid, x, y) {
  return x >= 0 && y >= 0 && x < grid.W && y < grid.H && grid.blocked[y * grid.W + x] === 0;
}

// Nearest walkable cell to (x, y), searching outwards ring by ring. Returns null if none.
export function nearestWalkable(grid, x, y) {
  const cx = Math.min(grid.W - 1, Math.max(0, Math.round(x)));
  const cy = Math.min(grid.H - 1, Math.max(0, Math.round(y)));
  if (isWalkable(grid, cx, cy)) return { x: cx, y: cy };
  const maxR = Math.max(grid.W, grid.H);
  for (let r = 1; r <= maxR; r++) {
    let best = null;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!isWalkable(grid, nx, ny)) continue;
        const d = Math.abs(dx) + Math.abs(dy);
        if (!best || d < best.d) best = { x: nx, y: ny, d };
      }
    }
    if (best) return { x: best.x, y: best.y };
  }
  return null;
}

// Breadth-first search from one cell; every orthogonal step is 1 m.
export function bfs(grid, sx, sy) {
  const { W, H, blocked } = grid;
  const dist = new Int32Array(W * H).fill(-1);
  const queue = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  const s = sy * W + sx;
  dist[s] = 0;
  queue[tail++] = s;
  while (head < tail) {
    const c = queue[head++];
    const x = c % W;
    const y = (c - x) / W;
    const nd = dist[c] + 1;
    if (x > 0) {
      const n = c - 1;
      if (dist[n] < 0 && !blocked[n]) {
        dist[n] = nd;
        queue[tail++] = n;
      }
    }
    if (x < W - 1) {
      const n = c + 1;
      if (dist[n] < 0 && !blocked[n]) {
        dist[n] = nd;
        queue[tail++] = n;
      }
    }
    if (y > 0) {
      const n = c - W;
      if (dist[n] < 0 && !blocked[n]) {
        dist[n] = nd;
        queue[tail++] = n;
      }
    }
    if (y < H - 1) {
      const n = c + W;
      if (dist[n] < 0 && !blocked[n]) {
        dist[n] = nd;
        queue[tail++] = n;
      }
    }
  }
  return dist;
}

// Cell path between two walkable cells (inclusive), following a BFS distance field from the target.
export function cellPath(grid, from, to) {
  const field = bfs(grid, to.x, to.y);
  const { W } = grid;
  let c = from.y * W + from.x;
  if (field[c] < 0) return [];
  const path = [{ x: from.x, y: from.y }];
  while (field[c] > 0) {
    const x = c % W;
    const y = (c - x) / W;
    const next = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1]
    ];
    for (const [nx, ny] of next) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= grid.H) continue;
      const n = ny * W + nx;
      if (field[n] === field[c] - 1) {
        c = n;
        path.push({ x: nx, y: ny });
        break;
      }
    }
  }
  return path;
}

// The aisle cell a picker stands on to reach a location, based on its pick face.
export function pickFaceCell(loc) {
  const midX = loc.x + Math.floor((loc.w - 1) / 2);
  const midY = loc.y + Math.floor((loc.d - 1) / 2);
  switch (loc.face) {
    case 'N':
      return { x: midX, y: loc.y - 1 };
    case 'S':
      return { x: midX, y: loc.y + loc.d };
    case 'W':
      return { x: loc.x - 1, y: midY };
    default:
      return { x: loc.x + loc.w, y: midY };
  }
}

/* ------------------------------------------------------------------ */
/* Layout preparation and validation                                   */
/* ------------------------------------------------------------------ */

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d;
}

export function validateLayout(layout) {
  const errors = [];
  const warnings = [];
  const ids = new Set();
  for (const loc of layout.locations) {
    if (!loc.id) errors.push('Una ubicazione non ha codice.');
    if (ids.has(loc.id)) errors.push(`Codice ubicazione duplicato: ${loc.id}.`);
    ids.add(loc.id);
    if (loc.w < 1 || loc.d < 1)
      errors.push(`${loc.id}: larghezza e profondità devono essere ≥ 1 m.`);
    if (loc.x < 0 || loc.y < 0 || loc.x + loc.w > layout.width || loc.y + loc.d > layout.depth) {
      errors.push(`${loc.id} esce dal perimetro del magazzino.`);
    }
  }
  const locs = layout.locations;
  let overlaps = 0;
  for (let i = 0; i < locs.length; i++) {
    for (let j = i + 1; j < locs.length; j++) {
      if (rectsOverlap(locs[i], locs[j])) {
        overlaps++;
        if (overlaps <= 5) warnings.push(`${locs[i].id} e ${locs[j].id} si sovrappongono.`);
      }
    }
  }
  if (overlaps > 5) warnings.push(`…e altre ${overlaps - 5} sovrapposizioni.`);
  return { errors, warnings };
}

// Builds everything the simulator needs for one layout: grid, pick nodes and a full distance matrix.
// Node 0 = start, node 1 = end, nodes 2.. = one per distinct pick cell.
export function prepareLayout(layout) {
  const { errors, warnings } = validateLayout(layout);
  const grid = buildGrid(layout);

  const resolvePoint = (p, label) => {
    const cell = nearestWalkable(grid, p.x, p.y);
    if (!cell) {
      errors.push(`${label}: nessuna cella libera disponibile.`);
      return { x: 0, y: 0 };
    }
    if (cell.x !== Math.round(p.x) || cell.y !== Math.round(p.y)) {
      warnings.push(
        `${label} cade su uno scaffale: spostato alla cella libera (${cell.x}, ${cell.y}).`
      );
    }
    return cell;
  };

  const start = resolvePoint(layout.start, 'Punto di partenza');
  const end = layout.sameEnd ? start : resolvePoint(layout.end || layout.start, 'Punto di arrivo');

  const cells = [start, end];
  const cellIndex = new Map();
  const nodeOfLoc = new Map();
  for (const loc of layout.locations) {
    const face = pickFaceCell(loc);
    let cell = isWalkable(grid, face.x, face.y) ? face : null;
    if (!cell) {
      cell = nearestWalkable(grid, face.x, face.y);
      if (cell)
        warnings.push(`${loc.id}: lato di prelievo bloccato, uso la cella libera più vicina.`);
    }
    if (!cell) {
      errors.push(`${loc.id}: nessuna cella di prelievo raggiungibile.`);
      continue;
    }
    const key = cell.y * grid.W + cell.x;
    if (!cellIndex.has(key)) {
      cellIndex.set(key, cells.length);
      cells.push(cell);
    }
    nodeOfLoc.set(loc.id, cellIndex.get(key));
  }

  const n = cells.length;
  const D = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    const field = bfs(grid, cells[i].x, cells[i].y);
    for (let j = 0; j < n; j++) {
      D[i * n + j] = field[cells[j].y * grid.W + cells[j].x];
    }
  }

  const unreachable = [];
  for (const loc of layout.locations) {
    const node = nodeOfLoc.get(loc.id);
    if (node === undefined) continue;
    if (D[node] < 0 || D[node * n + 1] < 0) unreachable.push(loc.id);
  }
  if (D[1] < 0) errors.push('Il punto di arrivo non è raggiungibile dalla partenza.');
  if (unreachable.length) {
    errors.push(
      `Ubicazioni non raggiungibili dalla partenza: ${unreachable.slice(0, 8).join(', ')}` +
        (unreachable.length > 8 ? ` (+${unreachable.length - 8})` : '') +
        '. Apri un corridoio o sposta gli scaffali.'
    );
  }

  // SKU -> stocked locations, nearest to the start first.
  const skuLocs = new Map();
  for (const loc of layout.locations) {
    const node = nodeOfLoc.get(loc.id);
    if (node === undefined || unreachable.includes(loc.id)) continue;
    for (const s of loc.stock || []) {
      if (!s.sku || !(s.qty > 0)) continue;
      if (!skuLocs.has(s.sku)) skuLocs.set(s.sku, []);
      skuLocs.get(s.sku).push({ locId: loc.id, node, qty: s.qty });
    }
  }
  for (const list of skuLocs.values()) {
    list.sort((a, b) => D[a.node] - D[b.node] || naturalCompare(a.locId, b.locId));
  }

  return { layout, grid, cells, n, D, nodeOfLoc, skuLocs, start, end, errors, warnings };
}

/* ------------------------------------------------------------------ */
/* Pick sequencing                                                     */
/* ------------------------------------------------------------------ */

function tourLength(D, n, seq) {
  let len = D[seq[0]]; // start (node 0) -> first stop
  for (let i = 1; i < seq.length; i++) len += D[seq[i - 1] * n + seq[i]];
  len += D[seq[seq.length - 1] * n + 1]; // last stop -> end
  return len;
}

export function routeDistance(prep, seq) {
  if (seq.length === 0) return prep.D[1];
  return tourLength(prep.D, prep.n, seq);
}

function nearestNeighbour(D, n, stops) {
  const left = stops.slice();
  const seq = [];
  let cur = 0;
  while (left.length) {
    let bi = 0;
    for (let i = 1; i < left.length; i++) {
      if (D[cur * n + left[i]] < D[cur * n + left[bi]]) bi = i;
    }
    cur = left[bi];
    seq.push(cur);
    left.splice(bi, 1);
  }
  return seq;
}

// 2-opt improvement on an open path with fixed endpoints (start node 0, end node 1).
function twoOpt(D, n, seq) {
  const path = [0, ...seq, 1];
  const m = path.length;
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 1; i < m - 2; i++) {
      for (let k = i + 1; k < m - 1; k++) {
        const a = path[i - 1];
        const b = path[i];
        const c = path[k];
        const d = path[k + 1];
        const delta = D[a * n + c] + D[b * n + d] - D[a * n + b] - D[c * n + d];
        if (delta < -1e-9) {
          for (let lo = i, hi = k; lo < hi; lo++, hi--) {
            const t = path[lo];
            path[lo] = path[hi];
            path[hi] = t;
          }
          improved = true;
        }
      }
    }
  }
  return path.slice(1, -1);
}

export const SEQUENCE_MODES = {
  alpha: 'Sequenza alfabetica (A→Z)',
  nearest: 'Vicino più prossimo',
  optimized: 'Ottimizzata (vicino + 2-opt)'
};

export function sequenceStops(prep, stops, mode, labelOfNode) {
  if (stops.length <= 1) return stops.slice();
  if (mode === 'alpha') {
    return stops.slice().sort((a, b) => naturalCompare(labelOfNode(a), labelOfNode(b)));
  }
  const nn = nearestNeighbour(prep.D, prep.n, stops);
  return mode === 'optimized' ? twoOpt(prep.D, prep.n, nn) : nn;
}

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

// Weighted sampling of distinct SKUs per order (an order line never repeats a SKU).
export function generateOrders(demand, s) {
  const rng = mulberry32(s.seed);
  const items = demand.filter((d) => d.sku && d.weight > 0);
  const orders = [];
  if (items.length === 0) return orders;
  const total = items.reduce((acc, d) => acc + d.weight, 0);
  const maxUnits = Math.max(1, Math.round(s.maxUnitsPerLine || 1));
  for (let o = 0; o < s.orders; o++) {
    let lines = Math.max(1, Math.round(s.linesPerOrder));
    if (s.variableLines) lines = 1 + Math.floor(rng() * (2 * lines - 1));
    lines = Math.min(lines, items.length);
    const taken = new Set();
    let takenWeight = 0;
    const orderLines = [];
    while (orderLines.length < lines) {
      let r = rng() * (total - takenWeight);
      let chosen = null;
      for (let i = 0; i < items.length; i++) {
        if (taken.has(i)) continue;
        r -= items[i].weight;
        if (r <= 0) {
          chosen = i;
          break;
        }
      }
      if (chosen === null) {
        for (let i = items.length - 1; i >= 0; i--) {
          if (!taken.has(i)) {
            chosen = i;
            break;
          }
        }
      }
      taken.add(chosen);
      takenWeight += items[chosen].weight;
      orderLines.push({ sku: items[chosen].sku, qty: 1 + Math.floor(rng() * maxUnits) });
    }
    orders.push({ id: `O${o + 1}`, lines: orderLines });
  }
  return orders;
}

/* ------------------------------------------------------------------ */
/* Simulation                                                          */
/* ------------------------------------------------------------------ */

export const DEFAULT_SETTINGS = {
  source: 'random', // 'random' | 'history'
  orders: 3000,
  linesPerOrder: 4,
  variableLines: true,
  maxUnitsPerLine: 2,
  seed: 42,
  speed: 1.1, // m/s, includes cart handling
  timePerLine: 10, // s per order line (locate, confirm, scan)
  timePerUnit: 3, // s per unit picked
  setupPerTour: 30, // s per tour (take cart, print list, drop at packing)
  batchSize: 1, // orders picked together in one tour
  sortPerLine: 2, // s per line to sort into the cart when batching
  sequence: 'optimized',
  robustness: true,
  dailyOrders: 1500,
  hourlyCost: 28, // fully loaded € per picker hour
  shiftHours: 7.5,
  workingDays: 250,
  utilisation: 0.85
};

function locLabelFn(prep) {
  const label = new Map();
  for (const loc of prep.layout.locations) {
    const node = prep.nodeOfLoc.get(loc.id);
    if (node === undefined) continue;
    const cur = label.get(node);
    if (cur === undefined || naturalCompare(loc.id, cur) < 0) label.set(node, loc.id);
  }
  return (node) => label.get(node) || '';
}

// Allocate every line of a tour to stocked locations. Stock is refilled before each tour.
// Preference: a location already on the route, then the one closest to the start.
function allocateTour(prep, tourOrders) {
  const used = new Map();
  const stops = new Set();
  const picks = [];
  let shortLines = 0;
  for (const order of tourOrders) {
    for (const line of order.lines) {
      const cands = prep.skuLocs.get(line.sku);
      if (!cands || cands.length === 0) {
        shortLines++;
        continue;
      }
      let need = line.qty;
      const free = (c) => c.qty - (used.get(c.locId + '|' + line.sku) || 0);
      const onRoute = cands.find((c) => stops.has(c.node) && free(c) >= need);
      const ordered = onRoute ? [onRoute, ...cands.filter((c) => c !== onRoute)] : cands;
      for (const c of ordered) {
        if (need <= 0) break;
        const f = free(c);
        if (f <= 0) continue;
        const take = Math.min(f, need);
        used.set(c.locId + '|' + line.sku, (used.get(c.locId + '|' + line.sku) || 0) + take);
        stops.add(c.node);
        picks.push({ locId: c.locId, node: c.node, sku: line.sku, qty: take, orderId: order.id });
        need -= take;
      }
      if (need > 0) shortLines++;
    }
  }
  return { stops: [...stops], picks, shortLines };
}

export function runLayout(prep, orders, s, keepRoutes = 25) {
  const k = Math.max(1, Math.round(s.batchSize || 1));
  const labelOfNode = locLabelFn(prep);
  const perOrderDist = [];
  const perOrderTime = [];
  const perOrderTravel = [];
  const visits = new Map();
  const units = new Map();
  const routes = [];
  let shortLines = 0;
  let totalLines = 0;

  for (let t = 0; t < orders.length; t += k) {
    const tourOrders = orders.slice(t, t + k);
    const { stops, picks, shortLines: sl } = allocateTour(prep, tourOrders);
    shortLines += sl;
    const seq = sequenceStops(prep, stops, s.sequence, labelOfNode);
    const dist = routeDistance(prep, seq);
    const travelTime = dist / s.speed;
    const shared = (travelTime + s.setupPerTour) / tourOrders.length;

    const visitedLocs = new Set();
    for (const p of picks) {
      visitedLocs.add(p.locId);
      units.set(p.locId, (units.get(p.locId) || 0) + p.qty);
    }
    for (const id of visitedLocs) visits.set(id, (visits.get(id) || 0) + 1);

    for (const order of tourOrders) {
      const lines = order.lines.length;
      const u = order.lines.reduce((acc, l) => acc + l.qty, 0);
      totalLines += lines;
      const handling =
        lines * s.timePerLine + u * s.timePerUnit + (k > 1 ? lines * s.sortPerLine : 0);
      perOrderDist.push(dist / tourOrders.length);
      perOrderTravel.push(travelTime / tourOrders.length);
      perOrderTime.push(shared + handling);
    }
    if (routes.length < keepRoutes) {
      routes.push({
        label:
          tourOrders.length > 1
            ? `Giro ${routes.length + 1} (${tourOrders.length} ordini)`
            : tourOrders[0].id,
        seq,
        stopsLabels: seq.map(labelOfNode),
        distance: dist
      });
    }
  }

  const sortedDist = perOrderDist.slice().sort((a, b) => a - b);
  const sortedTime = perOrderTime.slice().sort((a, b) => a - b);
  const avgTime = mean(perOrderTime);
  const avgTravel = mean(perOrderTravel);

  const hoursPerOrder = avgTime / 3600 / s.utilisation;
  const costPerOrder = hoursPerOrder * s.hourlyCost;
  const pickerHoursDay = hoursPerOrder * s.dailyOrders;

  // Hot zone: the 20 % of locations with the shortest round trip from start to end.
  const hot = hotZone(prep);
  let hotVisits = 0;
  let allVisits = 0;
  for (const [id, v] of visits) {
    allVisits += v;
    if (hot.has(id)) hotVisits += v;
  }

  return {
    layoutId: prep.layout.id,
    name: prep.layout.name,
    orders: orders.length,
    tours: Math.ceil(orders.length / k),
    avgDistance: mean(perOrderDist),
    p50Distance: quantile(sortedDist, 0.5),
    p95Distance: quantile(sortedDist, 0.95),
    minDistance: sortedDist[0] || 0,
    maxDistance: sortedDist[sortedDist.length - 1] || 0,
    avgTravelTime: avgTravel,
    avgHandlingTime: avgTime - avgTravel,
    avgTime,
    p95Time: quantile(sortedTime, 0.95),
    ordersPerHour: avgTime > 0 ? (3600 * s.utilisation) / avgTime : 0,
    costPerOrder,
    fte: pickerHoursDay / s.shiftHours,
    annualCost: costPerOrder * s.dailyOrders * s.workingDays,
    shortLines,
    totalLines,
    visits: Object.fromEntries(visits),
    units: Object.fromEntries(units),
    hotShare: allVisits ? (100 * hotVisits) / allVisits : 0,
    routes
  };
}

const roundTrip = (prep, node) => prep.D[node] + prep.D[node * prep.n + 1];

// Location ids in the hot zone: the closest 20 % by round trip start -> location -> end.
export function hotZone(prep, share = 0.2) {
  const costs = [];
  for (const [id, node] of prep.nodeOfLoc) {
    if (prep.D[node] >= 0) costs.push([id, roundTrip(prep, node)]);
  }
  costs.sort((a, b) => a[1] - b[1] || naturalCompare(a[0], b[0]));
  return new Set(costs.slice(0, Math.max(1, Math.ceil(costs.length * share))).map((c) => c[0]));
}

export function improvement(base, value) {
  if (!base) return 0;
  return (100 * (base - value)) / base;
}

// Runs every selected layout on the same order set. The first selected layout is the baseline.
export function simulate(project) {
  const s = { ...DEFAULT_SETTINGS, ...project.settings };
  const selected = project.layouts.filter((l) => l.include !== false);
  const issues = [];
  if (selected.length === 0) return { error: 'Seleziona almeno un layout da simulare.' };

  let orders;
  if (s.source === 'history') {
    orders = project.history || [];
    if (orders.length === 0)
      return { error: 'Nessun ordine storico caricato. Importa un CSV o usa ordini casuali.' };
  } else {
    orders = generateOrders(project.demand, s);
    if (orders.length === 0) return { error: 'Nessuno SKU con peso > 0 nel catalogo domanda.' };
  }

  const preps = selected.map(prepareLayout);
  for (const p of preps) {
    for (const e of p.errors) issues.push({ level: 'error', layout: p.layout.name, text: e });
    for (const w of p.warnings) issues.push({ level: 'warning', layout: p.layout.name, text: w });
  }
  if (issues.some((i) => i.level === 'error')) {
    return { error: 'Correggi gli errori del layout prima di simulare.', issues };
  }

  const results = preps.map((p) => runLayout(p, orders, s));
  const base = results[0];
  for (const r of results) {
    r.distanceGain = improvement(base.avgDistance, r.avgDistance);
    r.timeGain = improvement(base.avgTime, r.avgTime);
    r.annualSaving = base.annualCost - r.annualCost;
  }

  // Robustness: repeat with other seeds and report the range of the time gain per layout.
  if (s.robustness && s.source === 'random' && results.length > 1) {
    const seeds = [1, 2, 3, 4].map((i) => s.seed + i * 7919);
    const gains = results.map((r) => [r.timeGain]);
    for (const seed of seeds) {
      const alt = generateOrders(project.demand, { ...s, seed, orders: Math.min(s.orders, 1500) });
      const altRes = preps.map((p) => runLayout(p, alt, s, 0));
      altRes.forEach((r, i) => gains[i].push(improvement(altRes[0].avgTime, r.avgTime)));
    }
    results.forEach((r, i) => {
      r.timeGainMin = Math.min(...gains[i]);
      r.timeGainMax = Math.max(...gains[i]);
    });
  }

  const missing = new Set();
  for (const o of orders)
    for (const l of o.lines) if (!preps.some((p) => p.skuLocs.has(l.sku))) missing.add(l.sku);
  if (missing.size) {
    issues.push({
      level: 'warning',
      layout: 'Tutti',
      text: `SKU richiesti ma senza ubicazione: ${[...missing].slice(0, 8).join(', ')}${
        missing.size > 8 ? '…' : ''
      }.`
    });
  }
  for (const r of results) {
    if (r.shortLines > 0) {
      issues.push({
        level: 'warning',
        layout: r.name,
        text: `${r.shortLines} righe non evase su ${r.totalLines} (SKU senza stock sufficiente).`
      });
    }
  }

  return { settings: s, ordersCount: orders.length, source: s.source, results, issues, preps };
}

/* ------------------------------------------------------------------ */
/* Demand analysis and slotting                                        */
/* ------------------------------------------------------------------ */

// ABC class by cumulative share of pick weight (A ≤ 80 %, B ≤ 95 %, C rest).
export function abcClasses(demand) {
  const items = demand.filter((d) => d.weight > 0).sort((a, b) => b.weight - a.weight);
  const total = items.reduce((acc, d) => acc + d.weight, 0);
  const out = {};
  let cum = 0;
  for (const d of items) {
    const before = cum / total;
    cum += d.weight;
    out[d.sku] = before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C';
  }
  for (const d of demand) if (!(d.weight > 0)) out[d.sku] = 'C';
  return out;
}

// Reassigns stock to locations so the heaviest movers sit on the cheapest round trip
// (start -> location -> end). Location count, slot count per location and quantities are kept.
export function autoSlot(layout, demand) {
  const prep = prepareLayout(layout);
  const weight = new Map(demand.map((d) => [d.sku, d.weight || 0]));
  const entries = [];
  const slots = [];
  for (const loc of layout.locations) {
    const node = prep.nodeOfLoc.get(loc.id);
    const cost =
      node === undefined || prep.D[node] < 0 ? Infinity : prep.D[node] + prep.D[node * prep.n + 1];
    for (const s of loc.stock || []) {
      entries.push({ ...s });
      slots.push({ locId: loc.id, cost });
    }
  }
  // The picker always uses the nearest facing, so each SKU's first facing is ranked by velocity
  // and any extra facings of the same SKU act as reserve and go behind every primary facing.
  const seen = new Map();
  for (const e of entries) {
    e._rank = seen.get(e.sku) || 0;
    seen.set(e.sku, e._rank + 1);
  }
  entries.sort(
    (a, b) =>
      a._rank - b._rank ||
      (weight.get(b.sku) || 0) - (weight.get(a.sku) || 0) ||
      naturalCompare(a.sku, b.sku)
  );
  for (const e of entries) delete e._rank;
  slots.sort((a, b) => a.cost - b.cost || naturalCompare(a.locId, b.locId));

  const out = clone(layout);
  out.id = uid('layout');
  out.name = `${layout.name} · slotting ABC`;
  const byId = new Map(out.locations.map((l) => [l.id, l]));
  for (const l of out.locations) l.stock = [];
  entries.forEach((e, i) => byId.get(slots[i].locId).stock.push(e));
  return out;
}

/* ------------------------------------------------------------------ */
/* Move plan: which relocations deliver the saving                     */
/* ------------------------------------------------------------------ */

// True when two layouts share footprint, start and every location's geometry: only the stock differs.
export function sameFootprint(a, b) {
  if (a.width !== b.width || a.depth !== b.depth) return false;
  if (a.locations.length !== b.locations.length) return false;
  if (a.start.x !== b.start.x || a.start.y !== b.start.y || !a.sameEnd !== !b.sameEnd) return false;
  const byId = new Map(a.locations.map((l) => [l.id, l]));
  return b.locations.every((l) => {
    const o = byId.get(l.id);
    return o && o.x === l.x && o.y === l.y && o.w === l.w && o.d === l.d && o.face === l.face;
  });
}

// Turns "go from `base` to `variant`" into an ordered list of swaps, best first.
// Each step moves one SKU facing to a location it holds in `variant`; the occupant that does
// not belong there takes the freed location. Steps are chosen greedily on the net effect of
// both SKUs (share of order lines × change in round trip of the nearest facing), recomputed
// after every swap, so early steps never push a fast mover out of the way.
// `saving` is metres of round trip per 1,000 order lines: an index to rank moves. The
// simulated curve (moveCurve) is the measure of the real effect.
export function movePlan(base, variant, demand) {
  if (!sameFootprint(base, variant)) {
    return {
      error:
        'Il piano confronta due layout con le stesse ubicazioni: qui cambia anche la geometria.'
    };
  }
  const prep = prepareLayout(base);
  const cost = new Map();
  for (const [id, node] of prep.nodeOfLoc) {
    cost.set(id, prep.D[node] >= 0 ? roundTrip(prep, node) : Infinity);
  }
  const total = demand.reduce((a, d) => a + (d.weight > 0 ? d.weight : 0), 0);
  const w = new Map(demand.map((d) => [d.sku, total > 0 && d.weight > 0 ? d.weight / total : 0]));
  const abc = abcClasses(demand);

  // Working state: location -> list of SKUs, SKU -> set of locations.
  const at = new Map(base.locations.map((l) => [l.id, (l.stock || []).map((s) => s.sku)]));
  const where = new Map();
  for (const [id, list] of at) {
    for (const sku of list) {
      if (!where.has(sku)) where.set(sku, new Set());
      where.get(sku).add(id);
    }
  }
  const target = new Map();
  for (const l of variant.locations) {
    for (const s of l.stock || []) {
      if (!target.has(s.sku)) target.set(s.sku, new Set());
      target.get(s.sku).add(l.id);
    }
  }
  const best = (set) => {
    let m = Infinity;
    for (const id of set || []) m = Math.min(m, cost.get(id) ?? Infinity);
    return m;
  };
  const after = (set, remove, add) => {
    const n = new Set(set || []);
    if (remove) n.delete(remove);
    if (add) n.add(add);
    return best(n);
  };

  const steps = [];
  for (let guard = 0; guard < 100000; guard++) {
    let pick = null;
    for (const [sku, want] of target) {
      const have = where.get(sku);
      if (!have) continue;
      for (const t of want) {
        if (have.has(t)) continue;
        // Free the facing of this SKU that is not wanted and is farthest away.
        let src = null;
        for (const id of have) {
          if (!want.has(id) && (!src || cost.get(id) > cost.get(src))) src = id;
        }
        if (!src) continue;
        const occ = (at.get(t) || []).find((o) => !target.get(o)?.has(t)) ?? null;
        let net = (w.get(sku) || 0) * (best(have) - after(have, src, t));
        if (occ) net += (w.get(occ) || 0) * (best(where.get(occ)) - after(where.get(occ), t, src));
        if (!Number.isFinite(net)) net = 0;
        if (!pick || net > pick.net + 1e-12) pick = { sku, src, t, occ, net };
      }
    }
    if (!pick) break;
    const { sku, src, t, occ } = pick;
    at.get(src).splice(at.get(src).indexOf(sku), 1);
    where.get(sku).delete(src);
    if (occ) {
      at.get(t).splice(at.get(t).indexOf(occ), 1);
      where.get(occ).delete(t);
      at.get(src).push(occ);
      where.get(occ).add(src);
    }
    at.get(t).push(sku);
    where.get(sku).add(t);
    steps.push({
      sku,
      cls: abc[sku] || 'C',
      from: src,
      to: t,
      displaced: occ,
      saving: pick.net * 1000
    });
  }

  const net = steps.reduce((a, m) => a + m.saving, 0);
  let cum = 0;
  for (const m of steps) {
    cum += m.saving;
    m.cumShare = net > 0 ? cum / net : 0;
  }
  const vById = new Map(variant.locations.map((l) => [l.id, l]));
  const content = (l) =>
    (l?.stock || [])
      .map((x) => x.sku)
      .sort()
      .join('|');
  const changedLocations = base.locations.filter(
    (l) => content(l) !== content(vById.get(l.id))
  ).length;
  return { moves: steps, netSaving: net, changedLocations };
}

// Replays the first steps of a move plan on `base` and returns the new layout.
export function applyMoves(base, steps, name) {
  const out = clone(base);
  out.id = uid('layout');
  out.name = name;
  const byId = new Map(out.locations.map((l) => [l.id, l]));
  for (const m of steps) {
    const src = byId.get(m.from);
    const dst = byId.get(m.to);
    const i = src.stock.findIndex((s) => s.sku === m.sku);
    if (i < 0) continue;
    const entry = src.stock.splice(i, 1)[0];
    if (m.displaced) {
      const j = dst.stock.findIndex((s) => s.sku === m.displaced);
      if (j >= 0) src.stock.push(dst.stock.splice(j, 1)[0]);
    }
    dst.stock.push(entry);
  }
  return out;
}

// Measures, by simulation, how much of the full saving the first k moves deliver.
// Uses the same orders for every point (a sample of up to `sample` orders).
export function moveCurve(project, base, variant, plan, sample = 1500) {
  const s = { ...DEFAULT_SETTINGS, ...project.settings };
  let orders =
    s.source === 'history' && project.history?.length
      ? project.history.slice(0, sample)
      : generateOrders(project.demand, { ...s, orders: Math.min(s.orders, sample) });
  const n = plan.moves.length;
  const ks = [0];
  for (let k = 1; k < n; k = Math.max(k + 1, Math.round(k * 1.6))) ks.push(k);
  ks.push(n);
  const points = ks.map((k) => {
    const L = applyMoves(base, plan.moves.slice(0, k), 'k');
    const r = runLayout(prepareLayout(L), orders, s, 0);
    return { k, distance: r.avgDistance, time: r.avgTime };
  });
  const t0 = points[0].time;
  const tN = points[points.length - 1].time;
  for (const p of points) p.share = t0 - tN > 1e-9 ? (t0 - p.time) / (t0 - tN) : 0;
  const first = (q) => points.find((p) => p.share >= q - 1e-9)?.k ?? n;
  return {
    points,
    k80: first(0.8),
    k90: first(0.9),
    orders: orders.length,
    fullGain: improvement(t0, tN)
  };
}

/* ------------------------------------------------------------------ */
/* Rack generator                                                      */
/* ------------------------------------------------------------------ */

export const DEFAULT_GENERATOR = {
  orientation: 'vertical', // aisles run top-to-bottom ('vertical') or left-to-right ('horizontal')
  aisle: 3,
  rackDepth: 1,
  bayLength: 2,
  frontAisle: 4,
  backAisle: true,
  crossAisle: false,
  maxLocations: 0,
  qtyPerSlot: 40
};

export function generateRacks(width, depth, opts) {
  const p = { ...DEFAULT_GENERATOR, ...opts };
  const vertical = p.orientation === 'vertical';
  const across = vertical ? width : depth;
  const along = vertical ? depth : width;

  const rows = [];
  let c = p.aisle;
  while (c + p.rackDepth + p.aisle <= across) {
    if (c + 2 * p.rackDepth + p.aisle <= across) {
      rows.push({ pos: c, face: -1 }, { pos: c + p.rackDepth, face: 1 });
      c += 2 * p.rackDepth + p.aisle;
    } else {
      rows.push({ pos: c, face: -1 });
      c += p.rackDepth + p.aisle;
    }
  }

  const from = p.frontAisle;
  const to = along - (p.backAisle ? p.aisle : 0);
  const usable = to - from - (p.crossAisle ? p.aisle : 0);
  const bays = Math.max(0, Math.floor(usable / p.bayLength));
  const half = Math.ceil(bays / 2);
  const bayPos = [];
  for (let i = 0; i < bays; i++) {
    bayPos.push(from + i * p.bayLength + (p.crossAisle && i >= half ? p.aisle : 0));
  }

  let locs = [];
  rows.forEach((row, ri) => {
    bayPos.forEach((bp, bi) => {
      const loc = vertical
        ? { x: row.pos, y: bp, w: p.rackDepth, d: p.bayLength, face: row.face < 0 ? 'W' : 'E' }
        : { x: bp, y: row.pos, w: p.bayLength, d: p.rackDepth, face: row.face < 0 ? 'N' : 'S' };
      locs.push({ id: `${rowLetter(ri)}${bi + 1}`, ...loc, stock: [], _order: bi * 1000 + ri });
    });
  });
  if (p.maxLocations > 0 && locs.length > p.maxLocations) {
    locs = locs
      .slice()
      .sort((a, b) => a._order - b._order)
      .slice(0, p.maxLocations)
      .sort((a, b) => naturalCompare(a.id, b.id));
  }
  for (const l of locs) delete l._order;
  return locs;
}

// Places SKUs with no velocity logic: catalogue order, or a seeded shuffle that mimics
// slotting by arrival date. A neutral starting point to compare against.
export function fillSkus(locations, demand, qty, shuffleSeed = null) {
  const skus = demand.map((d) => d.sku).sort(naturalCompare);
  if (skus.length === 0) return locations;
  if (shuffleSeed !== null) {
    const rng = mulberry32(shuffleSeed);
    for (let i = skus.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [skus[i], skus[j]] = [skus[j], skus[i]];
    }
  }
  const sorted = locations.slice().sort((a, b) => naturalCompare(a.id, b.id));
  sorted.forEach((loc, i) => {
    loc.stock = [{ sku: skus[i % skus.length], qty }];
  });
  return locations;
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

export function parseCsv(text) {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const split = (line) => {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const header = split(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  return lines.slice(1).map((l) => {
    const cells = split(l);
    const row = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ''));
    return row;
  });
}

const num = (v) => Number(String(v).replace(',', '.'));

// Demand CSV: SKU, Weight (accepts "weight", "peso", "frequencyweight", "picks").
export function parseDemandCsv(text) {
  const rows = parseCsv(text);
  const out = [];
  for (const r of rows) {
    const sku = r.sku || r.articolo || r.item;
    const w = num(r.weight ?? r.peso ?? r.frequencyweight ?? r.picks ?? r.righe);
    if (sku && Number.isFinite(w) && w >= 0) out.push({ sku, weight: w });
  }
  return out;
}

// Order-line CSV: OrderID, SKU, Qty.
export function parseOrdersCsv(text) {
  const rows = parseCsv(text);
  const byOrder = new Map();
  for (const r of rows) {
    const id = r.orderid || r.order || r.ordine || r.idordine;
    const sku = r.sku || r.articolo || r.item;
    const qty = Math.max(1, Math.round(num(r.qty ?? r.quantity ?? r.qta ?? r.quantita ?? 1)) || 1);
    if (!id || !sku) continue;
    if (!byOrder.has(id)) byOrder.set(id, new Map());
    const lines = byOrder.get(id);
    lines.set(sku, (lines.get(sku) || 0) + qty);
  }
  return [...byOrder.entries()].map(([id, lines]) => ({
    id,
    lines: [...lines.entries()].map(([sku, qty]) => ({ sku, qty }))
  }));
}

// Demand weights from history = number of order lines per SKU.
export function demandFromHistory(history) {
  const count = new Map();
  for (const o of history) for (const l of o.lines) count.set(l.sku, (count.get(l.sku) || 0) + 1);
  return [...count.entries()]
    .map(([sku, weight]) => ({ sku, weight }))
    .sort((a, b) => b.weight - a.weight);
}

/* ------------------------------------------------------------------ */
/* WMS location master import                                          */
/* ------------------------------------------------------------------ */

const norm = (v) =>
  String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]/g, '');
const AISLE_KEYS = new Set([
  'aislename',
  'aisle',
  'corsia',
  'corridoio',
  'nomecorsia',
  'gang',
  'allee'
]);
const BAY_KEYS = new Set(['baynumber', 'bay', 'campata', 'modulo', 'colonna', 'baynr']);
const LEVEL_KEYS = new Set(['level', 'livello', 'piano', 'lvl', 'niveau']);
const BIN_KEYS = new Set(['binnumber', 'bin', 'posto', 'posizione', 'cella', 'slot', 'binnr']);
const CODE_RE = /^([A-Z]{1,3})(\d{1,3})([A-Z])(\d{1,2})$/;

const padBay = (b) => {
  const s = String(b ?? '').trim();
  return /^\d+$/.test(s) ? s.padStart(2, '0') : s;
};

// Reads WMS locations (aisle, bay, level, bin) from a sheet given as an array of rows.
// Finds every header group "Aisle | Bay | Level | Bin" anywhere in the sheet (side-by-side
// blocks are fine) and reads the rows below it. Falls back to cells that look like codes
// such as AR01C3 (aisle AR, bay 01, level C, bin 3).
export function parseLocationSheet(rows) {
  const found = new Map();
  const add = (aisle, bay, level, bin) => {
    const a = String(aisle ?? '')
      .trim()
      .toUpperCase();
    const b = padBay(bay);
    const l = String(level ?? '')
      .trim()
      .toUpperCase();
    const n = String(bin ?? '').trim();
    if (!a || !b || !l || !n || !/^\d+$/.test(n)) return;
    const code = `${a}${b}${l}${n}`;
    if (!found.has(code)) found.set(code, { aisle: a, bay: b, level: l, bin: Number(n), code });
  };
  let headers = 0;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    for (let c = 0; c + 3 < row.length; c++) {
      if (!AISLE_KEYS.has(norm(row[c]))) continue;
      if (
        !BAY_KEYS.has(norm(row[c + 1])) ||
        !LEVEL_KEYS.has(norm(row[c + 2])) ||
        !BIN_KEYS.has(norm(row[c + 3]))
      )
        continue;
      headers++;
      for (let k = r + 1; k < rows.length; k++) {
        const x = rows[k] || [];
        if (x[c] === undefined || x[c] === null || String(x[c]).trim() === '') continue;
        if (AISLE_KEYS.has(norm(x[c]))) break;
        add(x[c], x[c + 1], x[c + 2], x[c + 3]);
      }
    }
  }
  if (found.size === 0) {
    for (const row of rows) {
      for (const v of row || []) {
        const m = CODE_RE.exec(
          String(v ?? '')
            .trim()
            .toUpperCase()
        );
        if (m) add(m[1], m[2], m[3], m[4]);
      }
    }
  }
  return { locations: [...found.values()], headerGroups: headers };
}

export const DEFAULT_WMS_IMPORT = {
  binWidth: 1, // m along the aisle per bin position
  rackDepth: 1, // m
  walkway: 3, // m between the two sides of an aisle
  frontAisle: 4, // m at the entrance end (bay 01)
  backAisle: 2, // m at the far end
  margin: 1, // m between the outer racks and the walls
  reverseAisles: false, // place the aisles in the opposite order
  oddSide: 'right' // odd bins on the right side when walking in from the entrance
};

// Builds a 2D layout from WMS locations. Each aisle is a walkway with racks on both sides;
// consecutive aisles stand back to back. Bay 01 is at the entrance (top of the plan) and
// each bay holds its bin positions in order along the aisle. Every floor position stacks
// all its levels: one simulated location per aisle/bay/bin, carrying the WMS codes.
export function layoutFromWms(list, opts = {}) {
  const p = { ...DEFAULT_WMS_IMPORT, ...opts };
  const aisles = [...new Set(list.map((l) => l.aisle))];
  if (!p.reverseAisles) aisles.sort((a, b) => naturalCompare(b, a));
  else aisles.sort(naturalCompare);
  const levels = [...new Set(list.map((l) => l.level))].sort(naturalCompare);

  // Floor positions per aisle and side.
  const pos = new Map();
  for (const l of list) {
    const odd = l.bin % 2 === 1;
    const side =
      (odd ? p.oddSide : p.oddSide === 'right' ? 'left' : 'right') === 'right' ? 'R' : 'L';
    const key = `${l.aisle}|${side}|${l.bay}|${l.bin}`;
    if (!pos.has(key)) pos.set(key, { aisle: l.aisle, side, bay: l.bay, bin: l.bin, codes: [] });
    pos.get(key).codes.push(l.code);
  }
  // Bin order inside a bay, per aisle and side (e.g. 1,3,5 or 2,4,6).
  const binsOf = new Map();
  for (const v of pos.values()) {
    const k = `${v.aisle}|${v.side}`;
    if (!binsOf.has(k)) binsOf.set(k, new Set());
    binsOf.get(k).add(v.bin);
  }
  const binsPerBay = Math.max(1, ...[...binsOf.values()].map((s) => s.size));
  const bayLen = binsPerBay * p.binWidth;
  const bays = [...new Set(list.map((l) => l.bay))].sort(naturalCompare);
  const bayIndex = new Map(bays.map((b, i) => [b, i]));

  // Facing down the aisle from the entrance, the right-hand side is towards smaller x.
  const aisleW = 2 * p.rackDepth + p.walkway;
  const width = 2 * p.margin + aisles.length * aisleW;
  const depth = p.frontAisle + bays.length * bayLen + p.backAisle;
  const locations = [];
  aisles.forEach((a, i) => {
    const x0 = p.margin + i * aisleW;
    for (const side of ['R', 'L']) {
      const order = [...(binsOf.get(`${a}|${side}`) || [])].sort((x, y) => x - y);
      for (const v of pos.values()) {
        if (v.aisle !== a || v.side !== side) continue;
        const k = order.indexOf(v.bin);
        locations.push({
          id: `${a}${v.bay}-${v.bin}`,
          x: side === 'R' ? x0 : x0 + p.rackDepth + p.walkway,
          y: p.frontAisle + bayIndex.get(v.bay) * bayLen + k * p.binWidth,
          w: p.rackDepth,
          d: p.binWidth,
          face: side === 'R' ? 'E' : 'W',
          stock: [],
          wms: v.codes.sort(naturalCompare)
        });
      }
    }
  });
  locations.sort((a, b) => naturalCompare(a.id, b.id));
  return {
    width,
    depth,
    levels: levels.length,
    levelNames: levels,
    aisles,
    locations,
    start: { x: Math.floor(width / 2), y: 1 }
  };
}

// Stock by WMS code or floor id: Location/Ubicazione, SKU, Qty.
export function parseStockSheet(rows) {
  let h = -1;
  let ci = {};
  for (let r = 0; r < Math.min(rows.length, 50) && h < 0; r++) {
    const keys = (rows[r] || []).map(norm);
    const find = (set) => keys.findIndex((k) => set.includes(k));
    const loc = find(['location', 'ubicazione', 'locazione', 'bin', 'binlocation', 'posizione']);
    const sku = find(['sku', 'articolo', 'item', 'codicearticolo', 'material', 'materiale']);
    if (loc >= 0 && sku >= 0) {
      h = r;
      ci = { loc, sku, qty: find(['qty', 'qta', 'quantita', 'quantity', 'giacenza', 'stock']) };
    }
  }
  if (h < 0) return [];
  const out = [];
  for (const row of rows.slice(h + 1)) {
    const loc = String(row?.[ci.loc] ?? '')
      .trim()
      .toUpperCase();
    const sku = String(row?.[ci.sku] ?? '').trim();
    if (!loc || !sku) continue;
    const q = ci.qty >= 0 ? Number(String(row[ci.qty]).replace(',', '.')) : 1;
    out.push({ loc, sku, qty: Number.isFinite(q) && q > 0 ? q : 1 });
  }
  return out;
}

// Puts stock rows on the layout's floor positions (matched by WMS code or by floor id).
// Replaces all existing stock. Returns counts and the codes that matched nothing.
export function applyStock(layout, rows) {
  const byCode = new Map();
  for (const l of layout.locations) {
    byCode.set(l.id.toUpperCase(), l);
    for (const c of l.wms || []) byCode.set(c.toUpperCase(), l);
  }
  for (const l of layout.locations) l.stock = [];
  const unknown = new Set();
  let placed = 0;
  for (const r of rows) {
    const l = byCode.get(r.loc);
    if (!l) {
      unknown.add(r.loc);
      continue;
    }
    const s = l.stock.find((x) => x.sku === r.sku);
    if (s) s.qty += r.qty;
    else l.stock.push({ sku: r.sku, qty: r.qty });
    placed++;
  }
  return { placed, unknown: [...unknown] };
}

/* ------------------------------------------------------------------ */
/* Sample project                                                      */
/* ------------------------------------------------------------------ */

export function sampleProject() {
  // 40 SKUs with a skewed (Pareto-like) demand curve, placed at random as if slotted by
  // arrival date. Example figures, not real data.
  const demand = [];
  for (let i = 0; i < 40; i++) {
    demand.push({
      sku: `SKU-${String(i + 1).padStart(3, '0')}`,
      weight: Math.round(400 / Math.pow(i + 1, 1.1))
    });
  }
  const width = 36;
  const depth = 30;
  const base = {
    rackHeight: 3,
    levels: 4,
    width,
    depth,
    start: { x: 1, y: 1 },
    sameEnd: true,
    end: { x: 1, y: 1 },
    include: true
  };

  const longitudinal = {
    ...base,
    id: 'layout-longitudinal',
    name: 'Corridoi longitudinali',
    generator: { ...DEFAULT_GENERATOR, orientation: 'vertical', maxLocations: 80 },
    locations: []
  };
  longitudinal.locations = fillSkus(
    generateRacks(width, depth, longitudinal.generator),
    demand,
    DEFAULT_GENERATOR.qtyPerSlot,
    7
  );

  const transverse = {
    ...base,
    id: 'layout-transverse',
    name: 'Corridoi trasversali + corridoio centrale',
    generator: {
      ...DEFAULT_GENERATOR,
      orientation: 'horizontal',
      crossAisle: true,
      maxLocations: 80
    },
    locations: []
  };
  transverse.locations = fillSkus(
    generateRacks(width, depth, transverse.generator),
    demand,
    DEFAULT_GENERATOR.qtyPerSlot,
    7
  );

  const slotted = autoSlot(longitudinal, demand);
  slotted.id = 'layout-longitudinal-abc';

  return {
    version: ENGINE_VERSION,
    name: 'Esempio — magazzino 36 × 30 m',
    layouts: [longitudinal, transverse, slotted],
    demand,
    history: [],
    settings: { ...DEFAULT_SETTINGS }
  };
}

export function emptyLayout(name = 'Nuovo layout') {
  return {
    id: uid('layout'),
    name,
    width: 30,
    depth: 24,
    rackHeight: 3,
    levels: 4,
    start: { x: 1, y: 1 },
    sameEnd: true,
    end: { x: 1, y: 1 },
    include: true,
    generator: { ...DEFAULT_GENERATOR },
    locations: []
  };
}
