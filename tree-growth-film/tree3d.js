'use strict';
// ============================================================
// tree3d.js — the living tree in three.js (WebGL), for "DARI BIJI".
//
// The hand-drawn canvas engine draws the world (paper, soil, sky, weather,
// birds, lettering); this module grows one procedural tree in real 3D and is
// composited into the film canvas as a transparent layer. The look is a paper
// diorama: toon-banded colour, ink outlines (inverted hull), an orthographic
// camera so the tree can sit exactly where the drawing wants it.
//
// Load order: core.js -> studio.js -> vendor/three.iife.js -> tree3d.js -> film.
// Deterministic: the skeleton is built once from rng(SEED); every frame is a
// pure function of the state object handed to TREE3D.render().
//
// state = {
//   g        0..1   overall structure growth (trunk, branches, twigs)
//   sizeWU   > 0    wanted total height in 2D world units
//   leafG    0..1   canopy "pop-in" driver
//   fall     0..1   fraction of leaves already falling (autumn)
//   autumn   0..1   0 = green season, 1 = full gold
//   snow     0..1   whiten surfaces (winter)
//   sway     rad    wind lean of the whole tree
//   yaw      rad    slow turntable about the trunk axis (shows the volume)
//   bark/leaf/leaf2/ink/snowCol   hex strings from PAL
// }
// view = { bx, by, scale } : tree origin lands at logical (bx, by);
// `scale` is logical pixels per 3D unit at the z=0 plane.
// ============================================================
const TREE3D = (() => {
  const T = window.THREE;
  const SEED = 20260921, U0 = 1;               // 3D unit = 1 world unit / rootScale

  // ---------- deterministic skeleton ----------
  const r = rng(SEED);
  const segs = [];      // {pivot, mesh, out, parent, L, birth, span, spineY, r}
  const leaves = [];    // {pos:[x,y,z], size, birth, fallOrder, phase, rot}
  const qFromDir = (dx, dy, dz) => new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(dx, dy, dz).normalize());

  function addSeg(parent, pos, dir, L, rad, birth, span, spineY) {
    const pivot = new T.Object3D();
    pivot.position.set(pos[0], pos[1], pos[2]);
    pivot.quaternion.copy(qFromDir(...dir));
    (parent ? parent.pivot : treeRoot).add(pivot);
    const s = { pivot, parent, L, rad, birth, span, spineY, mesh: null, out: null };
    segs.push(s);
    return s;
  }

    // taper unit cylinder: base radius 1, top 0.8, height 1, base at y=0
  function unitLimb(open) {
    const g = new T.CylinderGeometry(0.8, 1, 1, 7, 1, open);
    g.translate(0, 0.5, 0);
    return g;
  }

  const treeRoot = new T.Object3D();
  let scene, camera, renderer, glCanvas, barkMat, leafMat, inkMat, leafGeo, leafIM, leafOutIM, gradientMap, dirLight, hemiLight;
  let inited = false;

  function init() {
    if (inited) return;
    inited = true;
    glCanvas = document.createElement('canvas');
    // software-GL budget: no MSAA, render at 0.75x and let the 2D blit upscale
    renderer = new T.WebGLRenderer({ canvas: glCanvas, alpha: true, antialias: false, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    scene = new T.Scene();
    camera = new T.OrthographicCamera(-1, 1, 1, -1, -400, 800);

    // 3-step toon ramp
    const data = new Uint8Array([90, 160, 235]);
    gradientMap = new T.DataTexture(data, 3, 1, T.RedFormat);
    gradientMap.minFilter = T.NearestFilter; gradientMap.magFilter = T.NearestFilter;
    gradientMap.needsUpdate = true;

    barkMat = new T.MeshToonMaterial({ gradientMap });
    leafMat = new T.MeshToonMaterial({ gradientMap });
    inkMat = new T.MeshBasicMaterial({ color: 0x241a12, side: T.BackSide });

    dirLight = new T.DirectionalLight(0xffffff, 1.05); dirLight.position.set(120, 260, 180);
    hemiLight = new T.HemisphereLight(0xfff4dd, 0x6b5843, 0.55);
    scene.add(dirLight, hemiLight, treeRoot);

    // ---- grow the skeleton: trunk 3 links, then boughs/branches/twigs ----
    const HNOM = 6.2;                                 // nominal full height in u (approx)
    // trunk: a gentle S-curve of 3 links
    const tdirs = [[.06, 1, .02], [-.05, 1, .04], [.04, 1, -.03]];
    const tlens = [1.55, 1.4, 1.25], trads = [.4, .34, .28];
    let parent = null, pos = [0, 0, 0], spine = 0, tbirth = 0;
    for (let k = 0; k < 3; k++) {
      const L = tlens[k], d = tdirs[k], b = tbirth, sp = 0.22;
      spine += L * d[1] / Math.hypot(...d);
      parent = addSeg(parent, k ? [0, tlens[k - 1], 0] : pos, d, L, trads[k], b, sp, spine);
      tbirth += 0.055;
    }
    const trunkTop = parent;

    // boughs off the upper trunk: 5 main limbs, staggered around the compass
    const limbs = [];
    const limbSpec = [
      [0.42, 250, 38, 1.75, .155], [0.55, 110, 34, 1.9, .16],
      [0.68, 20, 40, 1.7, .145], [0.8, 185, 36, 1.55, .13], [0.92, 320, 44, 1.35, .115],
    ];
    for (const [tfrac, az, tilt, L, rad] of limbSpec) {
      const y = 1.5 + tfrac * 2.6;                     // along the trunk stack
      const a = az * Math.PI / 180, tl = tilt * Math.PI / 180;
      const dir = [Math.sin(a) * Math.sin(tl), Math.cos(tl), Math.cos(a) * Math.sin(tl)];
      const birth = 0.2 + tfrac * 0.22, span = 0.24;
      const base = addSeg(null, [0, y, 0], dir, L * 0.55, rad, birth, span, y + L * 0.4);
      const mid = addSeg(base, [0, L * 0.55, 0], [dir[0] * .5, 1, dir[2] * .5], L * 0.5, rad * 0.7, birth + 0.05, span, y + L * 0.85);
      limbs.push({ base, mid, L, y, a });
    }

    // sub-branches + twigs on each limb; leaves ride real branch geometry
    const leafAnchors = [];   // {host, along, ...rest of leaf attrs} — world pos baked after the build
    for (const { mid, y, a } of limbs) {
      const nKids = 2 + (r() * 2 | 0);
      for (let j = 0; j < nKids; j++) {
        const side = j % 2 ? 1 : -1;
        const az2 = a + side * (0.5 + r() * 0.5), tilt2 = (26 + r() * 18) * Math.PI / 180;
        const dir2 = [Math.sin(az2) * Math.sin(tilt2), Math.cos(tilt2), Math.cos(az2) * Math.sin(tilt2)];
        const L2 = 0.85 + r() * 0.45;
        const b2 = mid.birth + 0.13 + j * 0.02;
        const kid = addSeg(mid, [0, mid.L, 0], dir2, L2, 0.07, b2, 0.2, y + 2.0 + j * 0.2);
        // twig
        const az3 = az2 + side * (0.4 + r() * 0.4), tilt3 = (24 + r() * 20) * Math.PI / 180;
        const dir3 = [Math.sin(az3) * Math.sin(tilt3), Math.cos(tilt3), Math.cos(az3) * Math.sin(tilt3)];
        const twig = addSeg(kid, [0, L2, 0], dir3, 0.42 + r() * 0.2, 0.04, b2 + 0.09, 0.16, y + 2.5 + j * 0.2);
        // leaf clusters at the twig tip and along the sub-branch
        for (let q = 0; q < 5; q++) {
          leafAnchors.push({
            host: q === 4 ? twig : kid, along: q === 4 ? 0.85 : 0.3 + q * 0.2,
            size: 0.24 + r() * 0.15, birth: 0.42 + r() * 0.4, fallOrder: r(), phase: r() * 6.28, rot: r() * 6.28,
          });
        }
      }
    }
    // early cotyledons on the young stem (visible at low g, for the 2D->3D lift)
    const trunkMid = segs[1], trunkTop2 = segs[2];
    for (let k = 0; k < 4; k++) {
      leafAnchors.push({
        host: k < 2 ? trunkMid : trunkTop2, along: k < 2 ? 0.55 + k * 0.35 : 0.3 + (k - 2) * 0.45,
        size: 0.2, birth: 0.02 + k * 0.025, fallOrder: 0.5 + k * 0.1, phase: r() * 6.28, rot: r() * 6.28,
      });
    }

    // ---- meshes ----
    const limbGeo = unitLimb(false), outGeo = unitLimb(true);
    for (const s of segs) {
      s.mesh = new T.Mesh(limbGeo, barkMat);
      s.out = new T.Mesh(outGeo, inkMat);
      s.out.renderOrder = -1;
      s.pivot.add(s.mesh, s.out);
    }
    // bake leaf rest positions from real branch geometry (grow directions included)
    treeRoot.updateMatrixWorld(true);
    const _lp = new T.Vector3();
    for (const la of leafAnchors) {
      _lp.set(0, la.host.L * la.along, 0);
      la.host.pivot.localToWorld(_lp);
      leaves.push({ pos: [_lp.x + (r() - .5) * .16, _lp.y + (r() - .4) * .18, _lp.z + (r() - .5) * .16], size: la.size, birth: la.birth, fallOrder: la.fallOrder, phase: la.phase, rot: la.rot });
    }
    // instanced leaves + their ink shells
    leafGeo = new T.IcosahedronGeometry(1, 0);
    const outGeoL = new T.IcosahedronGeometry(1, 0); outGeoL.scale(1.07, 1.07, 1.07);
    leafIM = new T.InstancedMesh(leafGeo, leafMat, leaves.length);
    leafOutIM = new T.InstancedMesh(outGeoL, inkMat, leaves.length);
    leafOutIM.renderOrder = -1;
    leafIM.instanceMatrix.setUsage(T.DynamicDrawUsage);
    leafOutIM.instanceMatrix.setUsage(T.DynamicDrawUsage);
    treeRoot.add(leafIM, leafOutIM);

    treeRoot.userData.HNOM = HNOM;
  }

  const easeOutBack = t => t <= 0 ? 0 : t >= 1 ? 1 : 1 + 2.2 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
  const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const easeIn = t => clamp(t, 0, 1) ** 3;
  const clamp01 = x => clamp(x, 0, 1);

  const _m = new T.Matrix4(), _q = new T.Quaternion(), _p = new T.Vector3(), _s = new T.Vector3(), _e = new T.Euler();
  const _c = new T.Color(), _c2 = new T.Color();

  function render(state, view) {
    init();
    const { g, sizeWU, leafG = 0, fall = 0, autumn = 0, snow = 0, sway = 0, yaw = 0 } = state;

    // ---- camera: tree origin (0,0,0) -> logical (bx, by); scale px per u ----
    const RS = 0.75;                            // GL render scale (see init note)
    const gw = Math.round(OUT_W * RS), gh = Math.round(OUT_H * RS);
    if (glCanvas.width !== gw || glCanvas.height !== gh) {
      glCanvas.width = gw; glCanvas.height = gh;
      renderer.setSize(gw, gh, false);
    }
    // the ortho frustum still maps LOGICAL units (the 2D blit stretches GL -> W,H logical)
    const px = view.scale;                       // logical px per 3D unit
    const ox = (CX - view.bx) / px, oy = (view.by - CY) / px;
    camera.left = ox - CX / px; camera.right = ox + CX / px;
    camera.top = oy + CY / px; camera.bottom = oy - CY / px;
    camera.position.set(ox, oy, 300); camera.lookAt(ox, oy, 0);
    camera.updateProjectionMatrix();

    // ---- global pose ----
    treeRoot.rotation.set(0, yaw, sway, 'ZXY');
    // height match: scale the whole tree so its current natural top == sizeWU
    let natural = 0.001;
    for (const s of segs) {
      const prog = easeOut(clamp01((g - s.birth) / s.span));
      if (prog > 0) natural = Math.max(natural, s.spineY * prog * 0.92);
    }
    const rootScale = sizeWU / U0 / Math.max(0.35, natural);
    treeRoot.scale.setScalar(rootScale);

    // ---- limbs ----
    for (const s of segs) {
      const prog = easeOut(clamp01((g - s.birth) / s.span));
      // radius thickens over the whole life: a slim stem at the lift, a stout trunk at the end
      const thick = (0.12 + 0.88 * Math.pow(clamp01(g * 1.5 - s.birth * 0.8), 1.1)) * (1 - snow * 0.05);
      const rr = s.rad * thick;
      s.pivot.visible = prog > 0.005;
      if (!s.pivot.visible) continue;
      // child pivots ride the growing tip
      for (const kid of segs) if (kid.parent === s) kid.pivot.position.y = s.L * prog;
      s.mesh.scale.set(rr, Math.max(0.02, s.L * prog), rr);
      const e = 0.014 + rr * 0.06;                    // ink shell thickness (local)
      s.out.scale.set(rr + e, Math.max(0.02, s.L * prog) + e, rr + e);
      s.out.visible = prog > 0.02;
    }

    // ---- leaves ----
    _c.set(state.leaf || '#5d8f4e'); _c2.set(state.leaf2 || '#8fbf6a');
    const gold = new T.Color(state.autumnLeaf || '#e0a526');
    const gold2 = new T.Color(state.autumnLeaf2 || '#c97f2a');
    const snowC = new T.Color(state.snowCol || '#f4f2ec');
    for (let k = 0; k < leaves.length; k++) {
      const lf = leaves[k];
      const pop = easeOutBack(clamp01((leafG - lf.birth) / 0.2));
      const fallProg = lf.fallOrder < fall ? easeIn(clamp01((fall - lf.fallOrder) * 6 + 0.35)) : 0;
      const sc = Math.max(0.0001, pop * (1 - fallProg) * lf.size);
      // falling drift, pure function of state/time-ish
      const fp = fallProg;
      const dx = Math.sin(lf.phase + fp * 7) * 0.8 * fp + fp * 1.2;
      const dy = -fp * fp * 3.2;
      const dz = Math.cos(lf.phase + fp * 5) * 0.5 * fp;
      _p.set(lf.pos[0] + dx, lf.pos[1] + dy, lf.pos[2] + dz);
      _e.set(lf.rot + fp * 4, lf.phase, lf.rot * .5 + fp * 6);
      _q.setFromEuler(_e);
      _s.set(sc * 1.15, sc * 0.5, sc * 0.8);
      _m.compose(_p, _q, _s);
      leafIM.setMatrixAt(k, _m);
      _s.multiplyScalar(1.06);
      _m.compose(_p, _q, _s);
      leafOutIM.setMatrixAt(k, _m);
      // colour: green -> gold with autumn, dusted white with snow
      const mixC = _c.clone().lerp(_c2, (lf.phase % 1));
      mixC.lerp(fallProg > 0 ? gold2 : gold, autumn * (0.7 + 0.3 * ((lf.phase * 3) % 1)));
      if (snow > 0) mixC.lerp(snowC, snow * 0.65);
      leafIM.setColorAt(k, mixC);
    }
    leafIM.instanceMatrix.needsUpdate = true;
    leafOutIM.instanceMatrix.needsUpdate = true;
    if (leafIM.instanceColor) leafIM.instanceColor.needsUpdate = true;
    leafIM.visible = leafOutIM.visible = leafG > 0.001;

    // ---- material colours ----
    const bark = new T.Color(state.bark || '#8a6242').lerp(snowC, snow * 0.5);
    barkMat.color.copy(bark);
    leafMat.color.set('#ffffff');                  // per-instance colours drive it
    inkMat.color.set(state.ink || '#241a12');
    dirLight.intensity = 1.05 - snow * 0.25;

    renderer.render(scene, camera);
    // Read back through readPixels into a CPU scratch canvas. drawImage() from a
    // WebGL canvas directly poisons the CPU film canvas in software-GL Chromium:
    // every later readback (toDataURL) then costs seconds.
    readback(gw, gh);
    return scratch;
  }

  // ---- CPU readback: flip rows (GL is bottom-up) into an ImageData ----
  let scratch = null, scratchCtx = null, pix = null, img = null;
  function readback(gw, gh) {
    if (!scratch) { scratch = document.createElement('canvas'); scratchCtx = scratch.getContext('2d', { willReadFrequently: true }); }
    if (scratch.width !== gw || scratch.height !== gh) { scratch.width = gw; scratch.height = gh; pix = img = null; }
    const gl = renderer.getContext();
    if (!pix || pix.length !== gw * gh * 4) { pix = new Uint8Array(gw * gh * 4); img = scratchCtx.createImageData(gw, gh); }
    gl.readPixels(0, 0, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, pix);
    const d = img.data, row = gw * 4;
    for (let y = 0; y < gh; y++) d.set(pix.subarray((gh - 1 - y) * row, (gh - y) * row), y * row);
    scratchCtx.putImageData(img, 0, 0);
  }

  return { render, get canvas() { init(); return scratch || glCanvas; } };
})();
