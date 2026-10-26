// Pick Path Lab — 3D view of a layout (display only; the simulation stays on the 2D floor grid).
// three.js is loaded on demand the first time the 3D view opens, so the 2D tool works offline.
// Scene axes: x = layout x, z = layout y, y = height. 1 unit = 1 m.

const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
let threePromise = null;

export function loadThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  if (!threePromise) {
    threePromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = THREE_URL;
      s.onload = () => resolve(window.THREE);
      s.onerror = () => {
        threePromise = null;
        s.remove();
        reject(new Error('Impossibile caricare il motore 3D: serve una connessione a internet.'));
      };
      document.head.append(s);
    });
  }
  return threePromise;
}

function cssColor(THREE, name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  try {
    return new THREE.Color(v || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

// Collapse a cell path to its corner points so the route tube stays light.
function corners(cells) {
  if (cells.length < 3) return cells.slice();
  const out = [cells[0]];
  for (let i = 1; i < cells.length - 1; i++) {
    const a = cells[i - 1];
    const b = cells[i];
    const c = cells[i + 1];
    if (b.x - a.x !== c.x - b.x || b.y - a.y !== c.y - b.y) out.push(b);
  }
  out.push(cells[cells.length - 1]);
  return out;
}

export function createView3D(container, { onPick } = {}) {
  const THREE = window.THREE;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.domElement.className = 'view3d-canvas';
  renderer.domElement.setAttribute('aria-label', 'Vista 3D del magazzino');
  renderer.domElement.setAttribute('role', 'img');
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c2bc, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 0.55);
  sun.position.set(-30, 60, -20);
  scene.add(sun);

  let content = new THREE.Group();
  scene.add(content);
  let walker = null;
  let rackMeshes = [];
  const view = { theta: -Math.PI / 4, phi: 0.62, radius: 50, target: new THREE.Vector3() };
  let size = { W: 30, H: 24 };
  let frame = 0;

  function place() {
    const { theta, phi, radius, target } = view;
    camera.position.set(
      target.x + radius * Math.cos(phi) * Math.sin(theta),
      target.y + radius * Math.sin(phi),
      target.z + radius * Math.cos(phi) * Math.cos(theta)
    );
    camera.lookAt(target);
  }
  function render() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      place();
      renderer.render(scene, camera);
    });
  }

  function resize() {
    const w = Math.max(200, container.clientWidth);
    const h = Math.round(Math.min(640, Math.max(320, w * 0.62)));
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  function preset(name) {
    const { W, H } = size;
    view.target.set(W / 2, 0, H / 2);
    // Narrow screens need more distance to keep the whole footprint in frame.
    const fit = camera.aspect < 1 ? 1.7 : 1.2;
    view.radius = Math.max(W, H) * fit;
    if (name === 'top') {
      view.theta = 0;
      view.phi = 1.53;
    } else if (name === 'front') {
      view.theta = 0;
      view.phi = 0.32;
      view.radius = Math.max(W, H) * fit * 1.05;
    } else {
      view.theta = -Math.PI / 4;
      view.phi = 0.62;
    }
    render();
  }

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const pickMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

  // Frees what a scene rebuild created; the shared box and pick material are kept.
  function disposeGroup(g) {
    g.traverse((o) => {
      if (o.geometry && o.geometry !== unitBox) o.geometry.dispose();
      for (const m of [].concat(o.material || [])) {
        if (m === pickMat) continue;
        m.map?.dispose();
        m.dispose();
      }
    });
  }

  // Text lying flat on the floor, drawn on a canvas texture.
  function floorLabel(text, x, z, size, color) {
    const c = document.createElement('canvas');
    const fs = 96;
    const font = `700 ${fs}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    let ctx = c.getContext('2d');
    ctx.font = font;
    c.width = Math.ceil(ctx.measureText(text).width) + 24;
    c.height = Math.round(fs * 1.25);
    ctx = c.getContext('2d');
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 12, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry((size * c.width) / c.height, size),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(x, 0.02, z);
    content.add(plane);
  }

  // data: { layout, selected, heat: {locId: 0..1} | null, routeCells: [{x,y}] | null, stops: [{x,y}] }
  function update(data, { keepCamera = true } = {}) {
    const L = data.layout;
    const first = size.W !== L.width || size.H !== L.depth || !keepCamera;
    size = { W: L.width, H: L.depth };
    scene.remove(content);
    disposeGroup(content);
    content = new THREE.Group();
    scene.add(content);
    rackMeshes = [];

    const col = {
      floor: cssColor(THREE, '--floor', '#e3ece4'),
      line: cssColor(THREE, '--floor-line', '#cfdccf'),
      wall: cssColor(THREE, '--ink', '#172022'),
      rack: cssColor(THREE, '--steel-soft', '#d6e3eb'),
      steel: cssColor(THREE, '--steel', '#2f5f7c'),
      empty: cssColor(THREE, '--surface-2', '#f5f7f5'),
      sel: cssColor(THREE, '--accent', '#f0b90b'),
      route: cssColor(THREE, '--route', '#d1461b'),
      start: cssColor(THREE, '--good', '#2e7d4f'),
      end: cssColor(THREE, '--bad', '#b3261e'),
      heatLo: cssColor(THREE, '--heat-lo', '#f6e7a6'),
      heatHi: cssColor(THREE, '--heat-hi', '#c0392b')
    };
    scene.background = cssColor(THREE, '--surface', '#ffffff');

    const W = L.width;
    const H = L.depth;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshLambertMaterial({ color: col.floor })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(W / 2, 0, H / 2);
    content.add(floor);

    // 1 m floor grid and perimeter wall outline.
    const g = [];
    if (W * H <= 40000) {
      for (let x = 1; x < W; x++) g.push(x, 0.005, 0, x, 0.005, H);
      for (let z = 1; z < H; z++) g.push(0, 0.005, z, W, 0.005, z);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(g, 3));
    content.add(new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: col.line })));
    const wallH = 0.25;
    const wallMat = new THREE.MeshLambertMaterial({ color: col.wall });
    for (const [x, z, w, d] of [
      [W / 2, -0.05, W + 0.2, 0.1],
      [W / 2, H + 0.05, W + 0.2, 0.1],
      [-0.05, H / 2, 0.1, H],
      [W + 0.05, H / 2, 0.1, H]
    ]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
      m.position.set(x, wallH / 2, z);
      content.add(m);
    }

    // Pallet racking: blue uprights at bay boundaries, orange beams on every level and a
    // pallet with cartons on each level of an occupied position. Loads mean "position in
    // use": stock is known per floor position, not per level.
    const height = Math.max(0.5, L.rackHeight || 3);
    const levels = Math.max(1, Math.round(L.levels || 4));
    const levelH = height / levels;
    const white = new THREE.Color(0xffffff);
    const RACK = {
      upright: new THREE.Color('#2f62b4'),
      beam: new THREE.Color('#ef7b22'),
      pallet: new THREE.Color('#a8794a'),
      carton: new THREE.Color('#d6a467')
    };
    const catColor = {
      A: col.sel,
      B: col.steel.clone().lerp(white, 0.45),
      C: new THREE.Color('#c9d0cc'),
      moved: col.route.clone().lerp(white, 0.15)
    };
    const alongZ = (loc) => loc.face === 'E' || loc.face === 'W';
    const bayKey = (id) => String(id).replace(/-\d+$/, '');
    const startKey = (loc, at) =>
      alongZ(loc) ? `${loc.face}|${loc.x}|${loc.w}|${at}` : `${loc.face}|${loc.y}|${loc.d}|${at}`;
    const byStart = new Map();
    const byEnd = new Map();
    for (const loc of L.locations) {
      byStart.set(startKey(loc, alongZ(loc) ? loc.y : loc.x), loc);
      byEnd.set(startKey(loc, alongZ(loc) ? loc.y + loc.d : loc.x + loc.w), loc);
    }

    const uprights = [];
    const beams = [];
    const pallets = [];
    const cartons = [];
    const faceMarks = [];
    const U = 0.08;
    const selected = [];
    for (const loc of L.locations) {
      const z = alongZ(loc);
      const len = z ? loc.d : loc.w;
      const dep = z ? loc.w : loc.d;
      const a0 = z ? loc.y : loc.x;
      const c0 = z ? loc.x : loc.y;
      // Position in scene axes from (along, across, height).
      const P = (al, ac, y) => (z ? [c0 + ac, y, a0 + al] : [a0 + al, y, c0 + ac]);
      const S = (sl, sc, sy) => (z ? [sc, sy, sl] : [sl, sy, sc]);
      const prev = byEnd.get(startKey(loc, a0));
      const next = byStart.get(startKey(loc, a0 + len));
      const ends = [];
      if (!prev || bayKey(prev.id) !== bayKey(loc.id)) ends.push(0);
      if (!next) ends.push(len);
      for (const e of ends) {
        for (const ac of [U / 2, dep - U / 2]) {
          uprights.push({ p: P(e, ac, height / 2), s: S(U, U, height) });
        }
      }
      for (let k = 1; k <= levels; k++) {
        for (const ac of [U / 2, dep - U / 2]) {
          beams.push({ p: P(len / 2, ac, k * levelH - 0.05), s: S(len, 0.06, 0.1) });
        }
      }
      const occupied = loc.stock && loc.stock.length > 0;
      const p = data.paint?.[loc.id];
      let c = RACK.carton;
      if (data.paint) {
        if (p?.t !== undefined) c = col.heatLo.clone().lerp(col.heatHi, p.t);
        else if (p?.cat) c = catColor[p.cat] || c;
      }
      const isSel = loc.id === data.selected || !!data.found?.has(loc.id);
      if (isSel) {
        c = col.sel;
        selected.push(loc);
      }
      if (occupied) {
        for (let i = 0; i < levels; i++) {
          const base = i * levelH;
          const ch = Math.max(0.15, Math.min(levelH * 0.72, levelH - 0.28));
          pallets.push({ p: P(len / 2, dep / 2, base + 0.07), s: S(len * 0.82, dep * 0.86, 0.12) });
          cartons.push({
            p: P(len / 2, dep / 2, base + 0.13 + ch / 2),
            s: S(len * 0.76, dep * 0.8, ch),
            c
          });
        }
      }
      // Invisible box over the whole bay position, used to pick it with a click.
      const pick = new THREE.Mesh(unitBox, pickMat);
      pick.scale.set(loc.w, height, loc.d);
      pick.position.set(loc.x + loc.w / 2, height / 2, loc.y + loc.d / 2);
      pick.userData.locId = loc.id;
      content.add(pick);
      rackMeshes.push(pick);
      // Pick face: a strip on the floor in front of the open side.
      const f = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] }[loc.face] || [1, 0];
      faceMarks.push({
        x: loc.x + loc.w / 2 + (f[0] * (loc.w + 0.35)) / 2,
        z: loc.y + loc.d / 2 + (f[1] * (loc.d + 0.35)) / 2,
        w: f[0] ? 0.12 : loc.w * 0.8,
        d: f[1] ? 0.12 : loc.d * 0.8
      });
    }

    const dummy = new THREE.Object3D();
    const instanced = (items, color) => {
      const mat = new THREE.MeshLambertMaterial({ color: color || 0xffffff });
      const m = new THREE.InstancedMesh(unitBox, mat, Math.max(1, items.length));
      m.count = items.length;
      items.forEach((it, i) => {
        dummy.position.set(...it.p);
        dummy.scale.set(...it.s);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
        if (!color) m.setColorAt(i, it.c);
      });
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      content.add(m);
    };
    instanced(uprights, RACK.upright);
    instanced(beams, RACK.beam);
    instanced(pallets, RACK.pallet);
    if (cartons.length) instanced(cartons, null);

    const faceMat = new THREE.MeshBasicMaterial({ color: col.steel });
    for (const m of faceMarks) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(m.w, m.d), faceMat);
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(m.x, 0.01, m.z);
      content.add(strip);
    }
    const selLine = new THREE.LineBasicMaterial({ color: col.sel });
    for (const loc of selected) {
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(unitBox), selLine);
      e.scale.set(loc.w + 0.1, height + 0.1, loc.d + 0.1);
      e.position.set(loc.x + loc.w / 2, height / 2, loc.y + loc.d / 2);
      content.add(e);
    }

    // Aisle names painted on the floor in front of each aisle (letters of the location code).
    const groups = new Map();
    for (const loc of L.locations) {
      const key = (String(loc.id).match(/^[A-Za-z]+/) || [''])[0];
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(loc);
    }
    if (groups.size <= 40) {
      for (const [name, list] of groups) {
        const z = alongZ(list[0]);
        const minA = Math.min(...list.map((l) => (z ? l.y : l.x)));
        if (minA < 1.2) continue;
        // Centre of the walkway: between the racks that face it from either side.
        const lo = list.filter((l) => l.face === (z ? 'E' : 'S'));
        const hi = list.filter((l) => l.face === (z ? 'W' : 'N'));
        let cx;
        if (lo.length && hi.length) {
          const edge = Math.max(...lo.map((l) => (z ? l.x + l.w : l.y + l.d)));
          cx = (edge + Math.min(...hi.map((l) => (z ? l.x : l.y)))) / 2;
        } else {
          cx = list.reduce((acc, l) => acc + (z ? l.x + l.w / 2 : l.y + l.d / 2), 0) / list.length;
        }
        const size = Math.min(1.6, Math.max(0.8, minA * 0.45));
        if (z) floorLabel(name, cx, minA - size * 0.75, size, '#172022');
        else floorLabel(name, minA - size * 0.75, cx, size, '#172022');
      }
    }

    // Start and end.
    const s = L.start;
    const startMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, 0.3, 24),
      new THREE.MeshLambertMaterial({ color: col.start })
    );
    startMesh.position.set(s.x + 0.5, 0.15, s.y + 0.5);
    content.add(startMesh);
    floorLabel('Partenza', s.x + 2.6, s.y + 0.5, 0.7, '#2e7d4f');
    if (!L.sameEnd) {
      const e = L.end;
      const endMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.75, 0.3, 0.75),
        new THREE.MeshLambertMaterial({ color: col.end })
      );
      endMesh.position.set(e.x + 0.5, 0.15, e.y + 0.5);
      content.add(endMesh);
      floorLabel('Arrivo', e.x + 2.3, e.y + 0.5, 0.7, '#b3261e');
    }

    // Sample route as a tube a little above the floor, with stop markers.
    walker = null;
    if (data.routeCells && data.routeCells.length > 1) {
      const pts = corners(data.routeCells).map(
        (c) => new THREE.Vector3(c.x + 0.5, 0.12, c.y + 0.5)
      );
      const path = new THREE.CurvePath();
      for (let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
      const routeMat = new THREE.MeshBasicMaterial({ color: col.route });
      content.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(path, Math.max(8, pts.length * 6), 0.09, 6, false),
          routeMat
        )
      );
      for (const st of data.stops || []) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 16), routeMat);
        m.position.set(st.x + 0.5, 0.15, st.y + 0.5);
        content.add(m);
      }
      walker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.25, 1.75, 16),
        new THREE.MeshLambertMaterial({ color: col.route })
      );
      walker.position.set(-100, 0.875, -100);
      walker.visible = false;
      content.add(walker);
    }

    if (first) preset('iso');
    else render();
  }

  function setWalker(x, z) {
    if (!walker) return;
    walker.visible = true;
    walker.position.set(x, 0.875, z);
    render();
  }
  function hideWalker() {
    if (walker) walker.visible = false;
    render();
  }

  // Orbit: drag rotates, right-drag or Shift+drag pans, wheel or pinch zooms, click selects a rack.
  const el = renderer.domElement;
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), r: view.radius };
      drag = null;
    } else {
      drag = {
        x: e.clientX,
        y: e.clientY,
        sx: e.clientX,
        sy: e.clientY,
        pan: e.button === 2 || e.shiftKey
      };
    }
  });
  el.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      view.radius = Math.min(400, Math.max(3, (pinch.r * pinch.d) / Math.max(10, d)));
      render();
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.pan) {
      const k = view.radius / 600;
      const right = new THREE.Vector3(Math.cos(view.theta), 0, -Math.sin(view.theta));
      const fwd = new THREE.Vector3(Math.sin(view.theta), 0, Math.cos(view.theta));
      view.target.addScaledVector(right, -dx * k).addScaledVector(fwd, -dy * k);
    } else {
      view.theta -= dx * 0.008;
      view.phi = Math.min(1.53, Math.max(0.06, view.phi + dy * 0.006));
    }
    render();
  });
  const end = (e) => {
    const wasClick = drag && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5 && !drag.pan;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (wasClick && onPick) {
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(rackMeshes)[0];
      onPick(hit ? hit.object.userData.locId : null);
    }
    drag = null;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      view.radius = Math.min(400, Math.max(3, view.radius * Math.pow(1.0015, e.deltaY)));
      render();
    },
    { passive: false }
  );

  function destroy() {
    ro.disconnect();
    if (frame) cancelAnimationFrame(frame);
    disposeGroup(content);
    unitBox.dispose();
    pickMat.dispose();
    renderer.dispose();
    el.remove();
  }

  resize();
  return { update, preset, setWalker, hideWalker, destroy, canvas: el };
}
