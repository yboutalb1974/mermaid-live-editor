// Run with: node --test warehouse-sim/test/engine.check.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyMoves,
  autoSlot,
  moveCurve,
  movePlan,
  generateOrders,
  generateRacks,
  parseDemandCsv,
  parseOrdersCsv,
  prepareLayout,
  routeDistance,
  sampleProject,
  sequenceStops,
  simulate
} from '../src/engine.js';

const corridor = () => ({
  id: 't',
  name: 'Test',
  width: 10,
  depth: 5,
  start: { x: 0, y: 2 },
  sameEnd: true,
  end: { x: 0, y: 2 },
  locations: [
    // A wall of racks across the middle with one gap at y = 4.
    { id: 'W', x: 5, y: 0, w: 1, d: 4, face: 'W', stock: [{ sku: 'S1', qty: 10 }] },
    { id: 'E', x: 8, y: 2, w: 1, d: 1, face: 'W', stock: [{ sku: 'S2', qty: 10 }] }
  ]
});

test('distances follow aisles around racks', () => {
  const prep = prepareLayout(corridor());
  assert.deepEqual(prep.errors, []);
  const w = prep.nodeOfLoc.get('W'); // pick cell (4, 1)
  const e = prep.nodeOfLoc.get('E'); // pick cell (7, 2)
  assert.equal(prep.D[w], 4 + 1); // (0,2) -> (4,1)
  // (0,2) -> through the gap at y=4 -> (7,2): 5 right to x=5 at y=4 needs 2 down, 2 more right, 2 up
  assert.equal(prep.D[e], 2 + 7 + 2);
  assert.equal(routeDistance(prep, [w]), 10);
});

test('unreachable locations are reported', () => {
  const L = corridor();
  L.locations.push({ id: 'X', x: 5, y: 4, w: 1, d: 1, face: 'E', stock: [] }); // closes the gap
  const prep = prepareLayout(L);
  assert.ok(prep.errors.some((e) => e.includes('non raggiungibili')));
});

test('2-opt never makes a route longer than nearest neighbour', () => {
  const p = sampleProject();
  const prep = prepareLayout(p.layouts[0]);
  const nodes = [...new Set([...prep.nodeOfLoc.values()])];
  const label = (n) => String(n);
  for (let k = 0; k < 30; k++) {
    const stops = nodes.filter((_, i) => (i * 7 + k) % 9 === 0).slice(0, 8);
    const nn = routeDistance(prep, sequenceStops(prep, stops, 'nearest', label));
    const opt = routeDistance(prep, sequenceStops(prep, stops, 'optimized', label));
    assert.ok(opt <= nn + 1e-9);
  }
});

test('orders are reproducible and respect distinct SKUs per order', () => {
  const demand = [
    { sku: 'A', weight: 10 },
    { sku: 'B', weight: 5 },
    { sku: 'C', weight: 1 }
  ];
  const s = { seed: 7, orders: 200, linesPerOrder: 3, variableLines: false, maxUnitsPerLine: 1 };
  const a = generateOrders(demand, s);
  const b = generateOrders(demand, s);
  assert.deepEqual(a, b);
  for (const o of a) assert.equal(new Set(o.lines.map((l) => l.sku)).size, o.lines.length);
});

test('generator respects footprint and cap', () => {
  const locs = generateRacks(36, 30, { orientation: 'vertical', maxLocations: 50 });
  assert.equal(locs.length, 50);
  for (const l of locs) assert.ok(l.x >= 0 && l.y >= 0 && l.x + l.w <= 36 && l.y + l.d <= 30);
});

test('ABC slotting keeps stock and shortens travel on the sample', () => {
  const p = sampleProject();
  const base = p.layouts[0];
  const slotted = autoSlot(base, p.demand);
  const total = (L) => L.locations.reduce((a, l) => a + l.stock.reduce((b, s) => b + s.qty, 0), 0);
  assert.equal(total(slotted), total(base));
  const run = simulate({
    ...p,
    layouts: [base, slotted],
    settings: { ...p.settings, robustness: false }
  });
  assert.equal(run.error, undefined);
  assert.ok(run.results[1].avgDistance < run.results[0].avgDistance);
  assert.ok(run.results[1].timeGain > 0);
});

test('batching reduces distance per order', () => {
  const p = sampleProject();
  const single = simulate({ ...p, settings: { ...p.settings, robustness: false, batchSize: 1 } });
  const batch = simulate({ ...p, settings: { ...p.settings, robustness: false, batchSize: 4 } });
  assert.ok(batch.results[0].avgDistance < single.results[0].avgDistance);
});

test('CSV parsing handles separators, quotes and aggregation', () => {
  assert.deepEqual(parseDemandCsv('SKU;Peso\n"A;1";10\nB;2,5\n'), [
    { sku: 'A;1', weight: 10 },
    { sku: 'B', weight: 2.5 }
  ]);
  const orders = parseOrdersCsv('OrderID,SKU,Qty\n1,A,2\n1,A,1\n1,B,1\n2,C,\n');
  assert.equal(orders.length, 2);
  assert.deepEqual(orders[0].lines, [
    { sku: 'A', qty: 3 },
    { sku: 'B', qty: 1 }
  ]);
  assert.equal(orders[1].lines[0].qty, 1);
});

test('history mode uses the imported orders', () => {
  const p = sampleProject();
  p.history = [{ id: 'H1', lines: [{ sku: 'SKU-001', qty: 1 }] }];
  p.settings = { ...p.settings, source: 'history' };
  const run = simulate(p);
  assert.equal(run.ordersCount, 1);
  assert.equal(run.results[0].orders, 1);
});

test('move plan replays exactly into the proposed slotting and its curve rises', () => {
  const p = sampleProject();
  const [base, , slotted] = p.layouts;
  const plan = movePlan(base, slotted, p.demand);
  assert.equal(plan.error, undefined);
  assert.ok(plan.moves.length > 0);
  const key = (L) =>
    L.locations
      .map(
        (l) =>
          l.id +
          ':' +
          l.stock
            .map((s) => s.sku)
            .sort()
            .join(',')
      )
      .sort()
      .join(';');
  assert.equal(key(applyMoves(base, plan.moves, 'full')), key(slotted));
  const curve = moveCurve(
    { ...p, settings: { ...p.settings, orders: 800 } },
    base,
    slotted,
    plan,
    800
  );
  assert.ok(curve.k80 < plan.moves.length, 'a part of the moves should give 80 % of the gain');
  assert.ok(curve.points[1].share > 0, 'the first move should help');
});

test('move plan refuses layouts with different geometry', () => {
  const p = sampleProject();
  assert.ok(movePlan(p.layouts[0], p.layouts[1], p.demand).error);
});

test('hot zone share rises with ABC slotting', () => {
  const p = sampleProject();
  const run = simulate({ ...p, settings: { ...p.settings, robustness: false } });
  assert.ok(run.results[2].hotShare > run.results[0].hotShare);
});
