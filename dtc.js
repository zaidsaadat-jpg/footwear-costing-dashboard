/* ============================================================
   DESIGN-TO-COST / VALUE ENGINEERING TAB  (v5 — Sculpted 3D)
   ============================================================ */

const DTC_STORAGE = 'puma_dtc_scenario_v1';

const DTC_LEVERS = [
  {
    id: 'designComplexity',
    name: 'Design Complexity',
    owner: 'Design',
    desc: 'Number of panels, seams, decorative elements',
    appliesTo: 'materialsAndLabour',
    options: [
      { id: 'simple',   label: 'Simple',   costMultiplier: 0.85, valueMultiplier: 0.90, costHint: '−15%' },
      { id: 'standard', label: 'Standard', costMultiplier: 1.00, valueMultiplier: 1.00, costHint: 'base' },
      { id: 'complex',  label: 'Complex',  costMultiplier: 1.20, valueMultiplier: 1.25, costHint: '+20%' }
    ]
  },
  {
    id: 'materialSubstitution',
    name: 'Material Substitution',
    owner: 'Design + Procurement',
    desc: 'Raw material source and type',
    appliesTo: 'materials',
    options: [
      { id: 'premium',  label: 'Premium virgin', costMultiplier: 1.15, valueMultiplier: 1.10, costHint: '+15%' },
      { id: 'standard', label: 'Standard',        costMultiplier: 1.00, valueMultiplier: 1.00, costHint: 'base' },
      { id: 'recycled', label: 'Recycled',        costMultiplier: 0.95, valueMultiplier: 1.20, costHint: '−5%' },
      { id: 'bio',      label: 'Bio-based',       costMultiplier: 1.10, valueMultiplier: 1.30, costHint: '+10%' }
    ]
  },
  {
    id: 'automation',
    name: 'Operations Automation',
    owner: 'Engineering + Ops',
    desc: 'Level of automated cutting, stitching, assembly',
    appliesTo: 'labour',
    options: [
      { id: 'manual', label: 'Manual',       costMultiplier: 1.20, valueMultiplier: 0.95, costHint: '+20%' },
      { id: 'semi',   label: 'Semi-auto',    costMultiplier: 1.00, valueMultiplier: 1.00, costHint: 'base' },
      { id: 'full',   label: 'Fully auto',   costMultiplier: 0.88, valueMultiplier: 1.05, costHint: '−12%' }
    ]
  },
  {
    id: 'volume',
    name: 'Order Volume (per SKU)',
    owner: 'Procurement + Finance',
    desc: 'Annual order quantity, affects fixed cost amortisation',
    appliesTo: 'volume',
    options: [
      { id: 'low',  label: '1,000',   volumeMultiplier: 0.2,  costHint: '0.2×' },
      { id: 'mid',  label: '5,000',   volumeMultiplier: 1.0,  costHint: '1×' },
      { id: 'high', label: '25,000',  volumeMultiplier: 5.0,  costHint: '5×' },
      { id: 'mass', label: '100,000', volumeMultiplier: 20.0, costHint: '20×' }
    ]
  },
  {
    id: 'marginTarget',
    name: 'Factory Margin Target',
    owner: 'Finance + Procurement',
    desc: 'Margin the factory earns on FOB',
    appliesTo: 'margin',
    options: [
      { id: 'lean',    label: '6% (lean)',      margin: 6,  costHint: '−3pp' },
      { id: 'base',    label: '9% (base)',      margin: 9,  costHint: 'base' },
      { id: 'premium', label: '12% (premium)',  margin: 12, costHint: '+3pp' },
      { id: 'high',    label: '15% (high)',     margin: 15, costHint: '+6pp' }
    ]
  }
];

let dtcState = {};
let dtcProduct = null;
let valueMatrixChart = null;

let cad = {
  scene: null, camera: null, renderer: null, controls: null,
  group: null, edgeLines: null, texture: null,
  archetype: 'shoe',
  viewMode: 'solid',
  projection: 'perspective',
  materialPreset: 'matte',
  baseColor: '#2d6a4f',
  initialized: false,
  animating: false,
  lastW: 0, lastH: 0
};

// ---------- HELPERS ----------
function interp(t, table) {
  // table is [[t0, v0], [t1, v1], ...] sorted by t
  if (t <= table[0][0]) return table[0][1];
  if (t >= table[table.length - 1][0]) return table[table.length - 1][1];
  for (let i = 0; i < table.length - 1; i++) {
    const [t0, v0] = table[i];
    const [t1, v1] = table[i + 1];
    if (t >= t0 && t <= t1) {
      const u = (t - t0) / (t1 - t0);
      const s = u * u * (3 - 2 * u);  // smoothstep
      return v0 + (v1 - v0) * s;
    }
  }
  return table[table.length - 1][1];
}

// Sculpt an extruded geometry so it tapers along its length
function sculptGeometry(geo, opts) {
  const pos = geo.attributes.position;
  const minX = opts.minX, maxX = opts.maxX;
  const length = maxX - minX;

  // Find Y range first
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const yRange = maxY - minY;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const t = Math.max(0, Math.min(1, (x - minX) / length));

    const widthFactor = interp(t, opts.widthTable);
    const heightFactor = interp(t, opts.heightTable);
    const topShift = interp(t, opts.topShiftTable || [[0,0],[1,0]]);
    const soleShift = interp(t, opts.soleShiftTable || [[0,0],[1,0]]);

    // Normalised position between sole and top
    const yNorm = (y - minY) / yRange;

    // Compress height from sole upward
    const yScaled = minY + yRange * yNorm * heightFactor;

    // Apply top-shift (only affects the upper portion) and sole-shift
    // Top shift magnitude scales with yNorm, sole shift scales with (1 - yNorm)
    const yFinal = yScaled + topShift * yNorm + soleShift * (1 - yNorm);

    const zScaled = z * widthFactor;

    pos.setX(i, x);
    pos.setY(i, yFinal);
    pos.setZ(i, zScaled);
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------- STATE ----------
function initDtcState() {
  const saved = localStorage.getItem(DTC_STORAGE);
  if (saved) { try { dtcState = JSON.parse(saved); } catch(e) { dtcState = {}; } }
  DTC_LEVERS.forEach(lever => {
    if (!dtcState[lever.id]) {
      const baseOpt = lever.options.find(o => o.costHint === 'base') || lever.options[0];
      dtcState[lever.id] = baseOpt.id;
    }
  });
}
function saveDtcState() { localStorage.setItem(DTC_STORAGE, JSON.stringify(dtcState)); }

// ---------- COST COMPUTATION ----------
function computeDtcCost(product) {
  const baseCalc = calc(product);
  const designOpt = DTC_LEVERS.find(l => l.id === 'designComplexity').options.find(o => o.id === dtcState.designComplexity);
  const materialOpt = DTC_LEVERS.find(l => l.id === 'materialSubstitution').options.find(o => o.id === dtcState.materialSubstitution);
  const automationOpt = DTC_LEVERS.find(l => l.id === 'automation').options.find(o => o.id === dtcState.automation);
  const volumeOpt = DTC_LEVERS.find(l => l.id === 'volume').options.find(o => o.id === dtcState.volume);
  const marginOpt = DTC_LEVERS.find(l => l.id === 'marginTarget').options.find(o => o.id === dtcState.marginTarget);

  const matCost = baseCalc.mat * designOpt.costMultiplier * (materialOpt.costMultiplier || 1);
  const labCost = baseCalc.lab * designOpt.costMultiplier * (automationOpt.costMultiplier || 1);
  const ovhCost = baseCalc.ovh;
  const subtotal = matCost + labCost + ovhCost;
  const margin = subtotal * (marginOpt.margin / 100);
  const fob = subtotal + margin;

  const tier = getTierMultipliers();
  const baseMoq = product.moq.current * tier.moqMultiplier;
  const newMoq = baseMoq * volumeOpt.volumeMultiplier;
  const fixedPerUnit = product.moq.fixedCostPool / newMoq;
  const totalUnitCost = fob + fixedPerUnit;

  let valueScore = 50;
  if (designOpt.valueMultiplier) valueScore *= designOpt.valueMultiplier;
  if (materialOpt.valueMultiplier) valueScore *= materialOpt.valueMultiplier;
  if (automationOpt.valueMultiplier) valueScore *= automationOpt.valueMultiplier;
  valueScore = Math.min(100, Math.round(valueScore));

  return { matCost, labCost, ovhCost, margin, fob, fixedPerUnit, totalUnitCost, valueScore, newMoq };
}

// ---------- LEVERS ----------
function renderLevers() {
  const panel = document.getElementById('leversPanel');
  if (!panel) return;
  panel.innerHTML = '';
  DTC_LEVERS.forEach(lever => {
    const wrap = document.createElement('div');
    wrap.className = 'lever';
    const optionsHtml = lever.options.map(opt => {
      const active = dtcState[lever.id] === opt.id ? ' active' : '';
      return `<button class="lever-opt${active}" onclick="selectLeverOption('${lever.id}','${opt.id}')">
        ${opt.label}<span class="cost-hint">${opt.costHint || ''}</span>
      </button>`;
    }).join('');
    wrap.innerHTML = `
      <div class="lever-header">
        <span class="lever-name">${lever.name}</span>
        <span class="lever-owner">${lever.owner}</span>
      </div>
      <div class="lever-options">${optionsHtml}</div>`;
    panel.appendChild(wrap);
  });
}
function selectLeverOption(leverId, optionId) {
  dtcState[leverId] = optionId;
  saveDtcState();
  renderLevers(); updateDtcImpact(); renderActionBoard();
  renderScenarioCompare(); renderValueMatrix();
}
function resetLevers() {
  localStorage.removeItem(DTC_STORAGE);
  dtcState = {};
  initDtcState(); saveDtcState();
  renderLevers(); updateDtcImpact(); renderActionBoard();
  renderScenarioCompare(); renderValueMatrix();
}
function applyLeanScenario() {
  dtcState.designComplexity = 'simple';
  dtcState.materialSubstitution = 'recycled';
  dtcState.automation = 'full';
  dtcState.volume = 'mass';
  dtcState.marginTarget = 'lean';
  saveDtcState();
  renderLevers(); updateDtcImpact(); renderActionBoard();
  renderScenarioCompare(); renderValueMatrix();
}
function applyPremiumScenario() {
  dtcState.designComplexity = 'complex';
  dtcState.materialSubstitution = 'bio';
  dtcState.automation = 'full';
  dtcState.volume = 'high';
  dtcState.marginTarget = 'premium';
  saveDtcState();
  renderLevers(); updateDtcImpact(); renderActionBoard();
  renderScenarioCompare(); renderValueMatrix();
}

// ---------- IMPACT ----------
function updateDtcImpact() {
  if (!dtcProduct) return;
  const base = calc(dtcProduct);
  const curr = computeDtcCost(dtcProduct);
  document.getElementById('dtcBaseFob').textContent = fmt(base.fob);
  document.getElementById('dtcCurrentFob').textContent = fmt(curr.fob);
  const delta = curr.fob - base.fob;
  const deltaPct = (delta / base.fob) * 100;
  const deltaEl = document.getElementById('dtcDelta');
  deltaEl.textContent = (delta > 0 ? '+' : '') + fmt(delta) + ' (' + (delta > 0 ? '+' : '') + deltaPct.toFixed(1) + '%)';
  deltaEl.classList.toggle('positive', delta < 0);
  document.getElementById('dtcLanded').textContent = fmt(curr.totalUnitCost);
  document.getElementById('dtcValueScore').textContent = curr.valueScore + ' / 100';
}

// ---------- VALUE MATRIX ----------
function renderValueMatrix() {
  const ctx = document.getElementById('valueMatrixChart');
  if (!ctx) return;
  if (valueMatrixChart) { try { valueMatrixChart.destroy(); } catch(e){} }
  const palette = ['#4a148c', '#00695c', '#bf360c', '#283593', '#6a1b9a'];
  const datasets = [];
  DTC_LEVERS.forEach((lever, idx) => {
    if (lever.appliesTo === 'volume' || lever.appliesTo === 'margin') return;
    const points = lever.options.map(opt => ({
      x: ((opt.costMultiplier || 1) - 1) * 100,
      y: ((opt.valueMultiplier || 1) - 1) * 100,
      label: opt.label, lever: lever.name,
      r: dtcState[lever.id] === opt.id ? 12 : 6
    }));
    datasets.push({
      label: lever.name, data: points,
      backgroundColor: palette[idx % palette.length],
      borderColor: '#fff', borderWidth: 2,
      pointRadius: points.map(p => p.r), pointHoverRadius: 14
    });
  });
  valueMatrixChart = new Chart(ctx, {
    type: 'scatter', data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => {
          const p = ctx.raw;
          return `${p.lever}: ${p.label} (Cost ${p.x >= 0 ? '+' : ''}${p.x.toFixed(0)}%, Value ${p.y >= 0 ? '+' : ''}${p.y.toFixed(0)}%)`;
        }}},
        title: { display: true, text: 'Cost impact (X) vs Value impact (Y) — larger bubbles = currently selected',
          font: { size: 12, weight: 'normal' }, color: '#666' }
      },
      scales: {
        x: { title: { display: true, text: 'Cost impact (%) — negative = cheaper' },
             grid: { color: c => c.tick.value === 0 ? '#999' : '#eee' }, min: -25, max: 25 },
        y: { title: { display: true, text: 'Value impact (%) — positive = higher perceived value' },
             grid: { color: c => c.tick.value === 0 ? '#999' : '#eee' }, min: -15, max: 35 }
      }
    }
  });
}

// ---------- ACTION BOARD ----------
function renderActionBoard() {
  const board = document.getElementById('actionBoard'); if (!board) return;
  board.innerHTML = '';
  DTC_LEVERS.forEach(lever => {
    const selectedOpt = lever.options.find(o => o.id === dtcState[lever.id]);
    if (!selectedOpt) return;
    const card = document.createElement('div');
    card.className = 'action-card';
    card.innerHTML = `
      <div class="owner">${lever.owner}</div>
      <div class="lever-name">${lever.name}</div>
      <div class="lever-desc">${lever.desc}</div>
      <div class="lever-impact">
        <strong>Current:</strong> ${selectedOpt.label}<br>
        <strong>Impact:</strong> ${selectedOpt.costHint || '—'} on cost${selectedOpt.valueMultiplier ? ' · value ' + ((selectedOpt.valueMultiplier - 1) * 100).toFixed(0) + '%' : ''}
      </div>`;
    board.appendChild(card);
  });
}

// ---------- SCENARIO COMPARE ----------
function renderScenarioCompare() {
  const wrap = document.getElementById('scenarioCompare');
  if (!wrap || !dtcProduct) return;
  wrap.innerHTML = '';
  const base = calc(dtcProduct);
  const curr = computeDtcCost(dtcProduct);
  const baselineCol = document.createElement('div');
  baselineCol.className = 'scenario-col current';
  baselineCol.innerHTML = `
    <h4>📌 Baseline (from Dashboard)</h4>
    <div class="scenario-line"><span class="lbl">Materials</span><span class="val">${fmt(base.mat)}</span></div>
    <div class="scenario-line"><span class="lbl">Labour (CMT)</span><span class="val">${fmt(base.lab)}</span></div>
    <div class="scenario-line"><span class="lbl">Overheads</span><span class="val">${fmt(base.ovh)}</span></div>
    <div class="scenario-line"><span class="lbl">Factory margin</span><span class="val">${fmt(base.margin)}</span></div>
    <div class="scenario-line highlight"><span class="lbl"><strong>FOB</strong></span><span class="val">${fmt(base.fob)}</span></div>`;
  const optCol = document.createElement('div');
  optCol.className = 'scenario-col optimized';
  optCol.innerHTML = `
    <h4>🎯 Your Scenario</h4>
    <div class="scenario-line"><span class="lbl">Materials</span><span class="val">${fmt(curr.matCost)}</span></div>
    <div class="scenario-line"><span class="lbl">Labour (CMT)</span><span class="val">${fmt(curr.labCost)}</span></div>
    <div class="scenario-line"><span class="lbl">Overheads</span><span class="val">${fmt(curr.ovhCost)}</span></div>
    <div class="scenario-line"><span class="lbl">Factory margin</span><span class="val">${fmt(curr.margin)}</span></div>
    <div class="scenario-line highlight"><span class="lbl"><strong>FOB</strong></span><span class="val">${fmt(curr.fob)}</span></div>
    <div class="scenario-line"><span class="lbl">Fixed / unit @ MOQ ${Math.round(curr.newMoq).toLocaleString()}</span><span class="val">${fmt(curr.fixedPerUnit)}</span></div>
    <div class="scenario-line highlight"><span class="lbl"><strong>Total Unit Cost</strong></span><span class="val">${fmt(curr.totalUnitCost)}</span></div>`;
  wrap.appendChild(baselineCol);
  wrap.appendChild(optCol);
}

/* ============================================================
   CAD-STYLE 3D VIEWER — SCULPTED MODELS
   ============================================================ */

function getMaterialPreset(name) {
  switch (name) {
    case 'matte':   return { roughness: 0.75, metalness: 0.05 };
    case 'gloss':   return { roughness: 0.25, metalness: 0.15 };
    case 'metal':   return { roughness: 0.35, metalness: 0.85 };
    case 'leather': return { roughness: 0.85, metalness: 0.02 };
    case 'fabric':  return { roughness: 0.95, metalness: 0.00 };
    default:        return { roughness: 0.6,  metalness: 0.05 };
  }
}

// ---------- RUNNING SHOE ----------
function buildShoeModel() {
  const group = new THREE.Group();

  // Sole shape (flat, extends full length)
  const soleShape = new THREE.Shape();
  soleShape.moveTo(-1.50, -0.05);
  soleShape.bezierCurveTo(-1.55, 0.05, -1.55, 0.15, -1.50, 0.20);
  soleShape.bezierCurveTo(-1.20, 0.22, -0.60, 0.22,  0.00, 0.22);
  soleShape.bezierCurveTo( 0.60, 0.22,  1.20, 0.22,  1.55, 0.20);
  soleShape.bezierCurveTo( 1.62, 0.15,  1.62, 0.05,  1.58, -0.05);
  soleShape.bezierCurveTo( 1.30, -0.10,  0.60, -0.12,  0.00, -0.12);
  soleShape.bezierCurveTo(-0.60, -0.12, -1.20, -0.10, -1.50, -0.05);

  // Upper silhouette
  const upperShape = new THREE.Shape();
  upperShape.moveTo(-1.45, -0.10);
  upperShape.bezierCurveTo(-1.52, 0.15, -1.52, 0.45, -1.45, 0.70);
  upperShape.bezierCurveTo(-1.38, 0.88, -1.20, 0.98, -0.95, 0.98);
  upperShape.bezierCurveTo(-0.72, 0.98, -0.55, 0.85, -0.42, 0.82);
  upperShape.bezierCurveTo(-0.25, 0.80, -0.05, 0.78,  0.15, 0.72);
  upperShape.bezierCurveTo( 0.42, 0.62,  0.68, 0.48,  0.92, 0.36);
  upperShape.bezierCurveTo( 1.18, 0.24,  1.38, 0.12,  1.50, 0.00);
  upperShape.bezierCurveTo( 1.58,-0.10,  1.58,-0.22,  1.52,-0.30);
  upperShape.bezierCurveTo( 1.42,-0.36,  1.20,-0.38,  0.90,-0.40);
  upperShape.bezierCurveTo( 0.45,-0.42,  0.00,-0.42, -0.45,-0.42);
  upperShape.bezierCurveTo(-0.90,-0.42, -1.30,-0.40, -1.45,-0.10);

  // --- OUTSOLE (bottom rubber) ---
  const outGeo = new THREE.ExtrudeGeometry(soleShape, {
    steps: 1, depth: 0.88, curveSegments: 48,
    bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 5
  });
  outGeo.translate(0, -0.55, -0.44);
  sculptGeometry(outGeo, {
    minX: -1.60, maxX: 1.62,
    widthTable: [
      [0.00, 0.92], [0.18, 0.98], [0.40, 0.86], [0.65, 0.98],
      [0.85, 0.72], [0.95, 0.50], [1.00, 0.20]
    ],
    heightTable: [
      [0.00, 1.00], [0.30, 0.95], [0.60, 0.90], [0.85, 0.85], [1.00, 0.85]
    ],
    soleShiftTable: [
      [0.00, -0.05], [0.30, 0.00], [0.70, 0.05], [1.00, 0.18]
    ]
  });
  const outMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.92, metalness: 0.02 });
  const outsole = new THREE.Mesh(outGeo, outMat);
  outsole.castShadow = true;
  group.add(outsole);

  // --- MIDSOLE (foam layer) ---
  const midGeo = new THREE.ExtrudeGeometry(soleShape, {
    steps: 1, depth: 0.90, curveSegments: 48,
    bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 6
  });
  midGeo.translate(0, -0.22, -0.45);
  sculptGeometry(midGeo, {
    minX: -1.60, maxX: 1.62,
    widthTable: [
      [0.00, 0.94], [0.18, 1.00], [0.40, 0.88], [0.65, 1.00],
      [0.85, 0.74], [1.00, 0.30]
    ],
    heightTable: [
      [0.00, 1.05], [0.25, 1.00], [0.55, 0.95], [0.85, 0.85], [1.00, 0.75]
    ],
    soleShiftTable: [
      [0.00, -0.03], [0.30, 0.00], [0.70, 0.05], [1.00, 0.15]
    ],
    topShiftTable: [
      [0.00, 0.00], [0.50, 0.00], [0.80, -0.02], [1.00, -0.05]
    ]
  });
  const midMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.65, metalness: 0.02 });
  const midsole = new THREE.Mesh(midGeo, midMat);
  midsole.castShadow = true;
  group.add(midsole);

  // --- UPPER ---
  const upperGeo = new THREE.ExtrudeGeometry(upperShape, {
    steps: 1, depth: 0.85, curveSegments: 48,
    bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 8
  });
  upperGeo.translate(0, 0.22, -0.425);
  sculptGeometry(upperGeo, {
    minX: -1.55, maxX: 1.58,
    widthTable: [
      [0.00, 0.92], [0.15, 0.98], [0.40, 0.82], [0.62, 0.94],
      [0.80, 0.72], [0.95, 0.42], [1.00, 0.18]
    ],
    heightTable: [
      [0.00, 1.00], [0.15, 1.02], [0.30, 0.92], [0.50, 0.88],
      [0.75, 0.80], [0.92, 0.62], [1.00, 0.42]
    ],
    topShiftTable: [
      [0.00, 0.00], [0.25, 0.02], [0.55, -0.05], [0.80, -0.15], [1.00, -0.25]
    ],
    soleShiftTable: [
      [0.00, 0.00], [0.60, 0.00], [0.85, 0.04], [1.00, 0.10]
    ]
  });
  const upperMat = new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.72, metalness: 0.05 });
  const upper = new THREE.Mesh(upperGeo, upperMat);
  upper.userData.isMainSurface = true;
  upper.castShadow = true;
  group.add(upper);

  // --- LACES (across the tongue) ---
  for (let i = 0; i < 4; i++) {
    const laceGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.55, 8);
    const lace = new THREE.Mesh(laceGeo, new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.9 }));
    lace.rotation.x = Math.PI / 2;
    const tx = 0.05 + i * 0.22;
    lace.position.set(tx, 0.68 - i * 0.06, 0);
    group.add(lace);
  }

  // --- HEEL TAB (small accent at the back) ---
  const heelTabGeo = new THREE.BoxGeometry(0.10, 0.28, 0.42, 4, 6, 8);
  const heelTab = new THREE.Mesh(heelTabGeo, new THREE.MeshStandardMaterial({ color: 0x1b4332, roughness: 0.5 }));
  heelTab.position.set(-1.40, 0.55, 0);
  group.add(heelTab);

  group.position.set(0, 0.05, 0);
  return group;
}

// ---------- FOOTBALL BOOT ----------
function buildBootModel() {
  const group = new THREE.Group();

  // Sole shape
  const soleShape = new THREE.Shape();
  soleShape.moveTo(-1.48, -0.05);
  soleShape.bezierCurveTo(-1.52, 0.05, -1.52, 0.15, -1.48, 0.20);
  soleShape.bezierCurveTo(-1.20, 0.22, -0.60, 0.22,  0.00, 0.22);
  soleShape.bezierCurveTo( 0.60, 0.22,  1.20, 0.22,  1.55, 0.18);
  soleShape.bezierCurveTo( 1.62, 0.12,  1.62, 0.02,  1.55,-0.08);
  soleShape.bezierCurveTo( 1.30,-0.12,  0.60,-0.14,  0.00,-0.14);
  soleShape.bezierCurveTo(-0.60,-0.14, -1.20,-0.12, -1.48,-0.05);

  // Upper silhouette (with taller sock collar)
  const upperShape = new THREE.Shape();
  upperShape.moveTo(-1.42, -0.10);
  upperShape.bezierCurveTo(-1.50, 0.20, -1.52, 0.55, -1.48, 0.90);
  upperShape.bezierCurveTo(-1.44, 1.10, -1.28, 1.20, -1.05, 1.22);
  upperShape.bezierCurveTo(-0.85, 1.24, -0.68, 1.14, -0.55, 1.08);
  upperShape.bezierCurveTo(-0.35, 1.00, -0.10, 0.90,  0.10, 0.80);
  upperShape.bezierCurveTo( 0.38, 0.68,  0.65, 0.52,  0.90, 0.38);
  upperShape.bezierCurveTo( 1.15, 0.26,  1.38, 0.14,  1.52, 0.02);
  upperShape.bezierCurveTo( 1.60,-0.08,  1.60,-0.22,  1.52,-0.32);
  upperShape.bezierCurveTo( 1.42,-0.40,  1.18,-0.42,  0.85,-0.44);
  upperShape.bezierCurveTo( 0.40,-0.46,  0.00,-0.46, -0.42,-0.46);
  upperShape.bezierCurveTo(-0.85,-0.46, -1.25,-0.42, -1.42,-0.10);

  // --- Outsole ---
  const outGeo = new THREE.ExtrudeGeometry(soleShape, {
    steps: 1, depth: 0.82, curveSegments: 48,
    bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 5
  });
  outGeo.translate(0, -0.55, -0.41);
  sculptGeometry(outGeo, {
    minX: -1.55, maxX: 1.62,
    widthTable: [
      [0.00, 0.90], [0.20, 0.96], [0.45, 0.84], [0.65, 0.96],
      [0.85, 0.70], [1.00, 0.22]
    ],
    heightTable: [[0, 1], [0.5, 1], [1, 0.85]],
    soleShiftTable: [[0, -0.03], [0.7, 0.04], [1, 0.15]]
  });
  const outsole = new THREE.Mesh(outGeo, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.92 }));
  outsole.castShadow = true;
  group.add(outsole);

  // --- Studs ---
  const studPositions = [
    [-1.00, -0.68, -0.24], [-1.00, -0.68, 0.24],
    [-0.40, -0.70, -0.28], [-0.40, -0.70, 0.28],
    [ 0.20, -0.70, -0.28], [ 0.20, -0.70, 0.28],
    [ 0.75, -0.66, -0.28], [ 0.75, -0.66, 0.28],
    [ 1.25, -0.56, -0.20], [ 1.25, -0.56, 0.20]
  ];
  studPositions.forEach(([x, y, z]) => {
    const studGeo = new THREE.CylinderGeometry(0.055, 0.075, 0.14, 8);
    const stud = new THREE.Mesh(studGeo, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 }));
    stud.position.set(x, y, z);
    group.add(stud);
  });

  // --- Upper ---
  const upperGeo = new THREE.ExtrudeGeometry(upperShape, {
    steps: 1, depth: 0.80, curveSegments: 48,
    bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 8
  });
  upperGeo.translate(0, 0.22, -0.40);
  sculptGeometry(upperGeo, {
    minX: -1.52, maxX: 1.60,
    widthTable: [
      [0.00, 0.90], [0.18, 0.98], [0.45, 0.82], [0.65, 0.95],
      [0.85, 0.70], [1.00, 0.20]
    ],
    heightTable: [
      [0.00, 1.00], [0.20, 1.02], [0.50, 0.90], [0.75, 0.78], [1.00, 0.55]
    ],
    topShiftTable: [
      [0.00, 0.00], [0.30, 0.00], [0.60, -0.05], [0.85, -0.14], [1.00, -0.22]
    ],
    soleShiftTable: [
      [0.00, 0.00], [0.65, 0.00], [1.00, 0.12]
    ]
  });
  const upperMat = new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.62, metalness: 0.05 });
  const upper = new THREE.Mesh(upperGeo, upperMat);
  upper.userData.isMainSurface = true;
  upper.castShadow = true;
  group.add(upper);

  // --- Grip texture bands ---
  for (let i = 0; i < 4; i++) {
    const bandGeo = new THREE.BoxGeometry(0.42, 0.04, 0.72, 4, 3, 6);
    const band = new THREE.Mesh(bandGeo, new THREE.MeshStandardMaterial({ color: 0x1b4332, roughness: 0.45 }));
    band.position.set(-0.85 + i * 0.55, 0.60 - i * 0.10, 0);
    group.add(band);
  }

  group.position.set(0, 0.10, 0);
  return group;
}

// ---------- SPORTS SHIRT ----------
function buildShirtModel() {
  const group = new THREE.Group();

  // T-shirt front silhouette
  const bodyShape = new THREE.Shape();
  bodyShape.moveTo(-0.85,  1.30);
  bodyShape.bezierCurveTo(-1.05, 1.22, -1.35, 1.00, -1.50, 0.68);
  bodyShape.bezierCurveTo(-1.62, 0.38, -1.55, 0.05, -1.42, -0.10);
  bodyShape.bezierCurveTo(-1.30, -0.22, -1.18, -0.15, -1.15, 0.02);
  bodyShape.bezierCurveTo(-1.10, -0.42, -1.08, -0.85, -1.10, -1.25);
  bodyShape.bezierCurveTo(-1.12, -1.36, -1.00, -1.42, -0.85, -1.42);
  bodyShape.bezierCurveTo(-0.35, -1.46,  0.35, -1.46,  0.85, -1.42);
  bodyShape.bezierCurveTo( 1.00, -1.42,  1.12, -1.36,  1.10, -1.25);
  bodyShape.bezierCurveTo( 1.08, -0.85,  1.10, -0.42,  1.15,  0.02);
  bodyShape.bezierCurveTo( 1.18, -0.15,  1.30, -0.22,  1.42, -0.10);
  bodyShape.bezierCurveTo( 1.55,  0.05,  1.62,  0.38,  1.50,  0.68);
  bodyShape.bezierCurveTo( 1.35,  1.00,  1.05,  1.22,  0.85,  1.30);
  bodyShape.bezierCurveTo( 0.55,  1.24,  0.28,  1.00,  0.00,  1.00);
  bodyShape.bezierCurveTo(-0.28,  1.00, -0.55,  1.24, -0.85,  1.30);
  bodyShape.bezierCurveTo(-0.90,  1.31, -0.87,  1.31, -0.85,  1.30);

  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
    steps: 1, depth: 0.38, curveSegments: 40,
    bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 6
  });
  bodyGeo.translate(0, 0, -0.19);

  // Sculpt the shirt: shoulders wider, waist narrower, slight chest bulge
  const pos = bodyGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    // Width taper: shoulders wide, waist slightly narrower, hem medium
    const t = Math.max(0, Math.min(1, (1.2 - y) / 2.6));  // 0 at top, 1 at bottom
    const widthFactor = interp(t, [
      [0.00, 1.02], [0.20, 1.00], [0.45, 0.94], [0.70, 0.96], [1.00, 0.98]
    ]);

    // Chest bulge: front/back bulge at chest level (y ≈ 0.3)
    const chestBulge = Math.exp(-Math.pow((y - 0.30) / 0.55, 2)) * 0.14;

    pos.setX(i, x * widthFactor);
    pos.setZ(i, z + Math.sign(z) * chestBulge);
  }
  bodyGeo.computeVertexNormals();

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.92, metalness: 0.02 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.userData.isMainSurface = true;
  body.castShadow = true;
  group.add(body);

  // Collar
  const collarGeo = new THREE.TorusGeometry(0.40, 0.06, 10, 32, Math.PI);
  const collar = new THREE.Mesh(collarGeo, new THREE.MeshStandardMaterial({ color: 0x1b4332, roughness: 0.85 }));
  collar.position.set(0, 1.00, 0.06);
  collar.rotation.x = Math.PI / 2;
  collar.rotation.z = Math.PI;
  group.add(collar);

  group.scale.set(0.82, 0.82, 0.82);
  group.position.set(0, 0.10, 0);
  return group;
}

// ---------- SCENE ----------
function initCadViewer() {
  const container = document.getElementById('viewer3d');
  if (!container) return;

  if (!window.THREE) {
    container.innerHTML = '<p style="padding:20px;color:#c62828;font-size:13px;">Three.js failed to load.</p>';
    return;
  }

  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w < 10 || h < 10) { setTimeout(initCadViewer, 200); return; }

  if (cad.initialized) {
    cad.renderer.setSize(w, h);
    cad.camera.aspect = w / h;
    cad.camera.updateProjectionMatrix();
    cad.lastW = w; cad.lastH = h;
    return;
  }

  cad.scene = new THREE.Scene();
  cad.scene.background = new THREE.Color(0xf1f5f9);

  cad.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 1000);
  cad.camera.position.set(3.5, 2.2, 4.5);
  cad.camera.lookAt(0, 0.2, 0);

  cad.renderer = new THREE.WebGLRenderer({ antialias: true });
  cad.renderer.setSize(w, h);
  cad.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  if (cad.renderer.shadowMap) {
    cad.renderer.shadowMap.enabled = true;
    cad.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  container.innerHTML = '';
  container.appendChild(cad.renderer.domElement);

  cad.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 0.95);
  key.position.set(4, 6, 5);
  key.castShadow = true;
  cad.scene.add(key);
  const rim = new THREE.DirectionalLight(0xc7d2fe, 0.45);
  rim.position.set(-5, 2, -4);
  cad.scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(2, -2, 3);
  cad.scene.add(fill);

  if (THREE.GridHelper) {
    const grid = new THREE.GridHelper(10, 20, 0xcbd5e1, 0xe2e8f0);
    grid.position.y = -1.6;
    cad.scene.add(grid);
  }

  cad.group = new THREE.Group();
  cad.scene.add(cad.group);

  rebuildCadModel();

  if (typeof THREE.OrbitControls === 'function') {
    cad.controls = new THREE.OrbitControls(cad.camera, cad.renderer.domElement);
    cad.controls.enableDamping = true;
    cad.controls.dampingFactor = 0.08;
    cad.controls.enablePan = true;
    cad.controls.minDistance = 2.5;
    cad.controls.maxDistance = 12;
    cad.controls.target.set(0, 0.2, 0);
    cad.controls.update();
  }

  cad.initialized = true;
  cad.lastW = w;
  cad.lastH = h;

  if (!cad.animating) { cad.animating = true; animateCad(); }
}

function rebuildCadModel() {
  if (!cad.group) return;
  while (cad.group.children.length) cad.group.remove(cad.group.children[0]);

  let model;
  if (cad.archetype === 'boot')       model = buildBootModel();
  else if (cad.archetype === 'shirt') model = buildShirtModel();
  else                                model = buildShoeModel();

  const preset = getMaterialPreset(cad.materialPreset);
  model.traverse(child => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (cad.texture && child.userData.isMainSurface) {
        child.material.map = cad.texture;
        child.material.color.set(0xffffff);
      } else if (child.userData.isMainSurface) {
        child.material.color.set(cad.baseColor);
      }
      child.material.roughness = preset.roughness;
      child.material.metalness = preset.metalness;
      if (cad.viewMode === 'wireframe') child.material.wireframe = true;
      child.material.needsUpdate = true;
    }
  });

  cad.group.add(model);
  updateEdgeOverlay(model);
}

function updateEdgeOverlay(model) {
  if (cad.edgeLines) { cad.group.remove(cad.edgeLines); cad.edgeLines = null; }
  if (cad.viewMode !== 'technical' || !THREE.EdgesGeometry) return;
  const edgesGroup = new THREE.Group();
  model.traverse(child => {
    if (child.isMesh) {
      const edges = new THREE.EdgesGeometry(child.geometry, 25);
      const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x1a237e }));
      line.position.copy(child.position);
      line.rotation.copy(child.rotation);
      line.scale.copy(child.scale);
      edgesGroup.add(line);
    }
  });
  cad.edgeLines = edgesGroup;
  cad.group.add(cad.edgeLines);
}

function animateCad() {
  requestAnimationFrame(animateCad);
  if (!cad.renderer) return;
  const container = document.getElementById('viewer3d');
  if (container) {
    const w = container.clientWidth, h = container.clientHeight;
    if ((w !== cad.lastW || h !== cad.lastH) && w > 10 && h > 10) {
      cad.renderer.setSize(w, h);
      cad.camera.aspect = w / h;
      cad.camera.updateProjectionMatrix();
      cad.lastW = w; cad.lastH = h;
    }
  }
  if (cad.controls) cad.controls.update();
  else if (cad.group) cad.group.rotation.y += 0.003;
  cad.renderer.render(cad.scene, cad.camera);
}

// ---------- VIEW CONTROLS ----------
function setArchetype(type) {
  cad.archetype = type;
  rebuildCadModel();
  setActiveChip('archetypeChips', type);
}
function setViewMode(mode) {
  cad.viewMode = mode;
  cad.group.traverse(c => {
    if (c.isMesh) { c.material.wireframe = (mode === 'wireframe'); c.material.needsUpdate = true; }
  });
  const model = cad.group.children.find(c => c.type === 'Group' && c !== cad.edgeLines);
  if (model) updateEdgeOverlay(model);
  setActiveChip('viewChips', mode);
}
function setProjection(proj) {
  const container = document.getElementById('viewer3d');
  if (!container) return;
  const w = container.clientWidth, h = container.clientHeight;
  if (w < 10 || h < 10) return;
  const aspect = w / h;
  const target = cad.controls ? cad.controls.target.clone() : new THREE.Vector3(0, 0.2, 0);
  const oldPos = cad.camera.position.clone();

  if (proj === 'orthographic') {
    const size = 3.5;
    cad.camera = new THREE.OrthographicCamera(-size * aspect, size * aspect, size, -size, 0.1, 1000);
  } else {
    cad.camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 1000);
  }
  cad.camera.position.copy(oldPos);
  cad.camera.lookAt(target);

  if (typeof THREE.OrbitControls === 'function') {
    if (cad.controls) cad.controls.dispose();
    cad.controls = new THREE.OrbitControls(cad.camera, cad.renderer.domElement);
    cad.controls.enableDamping = true;
    cad.controls.dampingFactor = 0.08;
    cad.controls.target.copy(target);
    cad.controls.update();
  }
  cad.projection = proj;
  setActiveChip('projectionChips', proj);
}
function setViewPreset(view) {
  if (!cad.camera) return;
  const t = new THREE.Vector3(0, 0.2, 0);
  const d = 5.5;
  if (view === 'front') cad.camera.position.set(0, 0.2, d);
  else if (view === 'side') cad.camera.position.set(d, 0.2, 0);
  else if (view === 'top') cad.camera.position.set(0.01, d, 0.01);
  else cad.camera.position.set(d * 0.7, d * 0.5, d * 0.7);
  cad.camera.lookAt(t);
  if (cad.controls) { cad.controls.target.copy(t); cad.controls.update(); }
}
function setMaterialPreset(preset) {
  cad.materialPreset = preset;
  rebuildCadModel();
  setActiveChip('materialChips', preset);
}
function setBaseColor(hex) {
  cad.baseColor = hex;
  if (cad.texture) return;
  cad.group.traverse(c => {
    if (c.isMesh && c.userData.isMainSurface) {
      c.material.color.set(hex);
      c.material.needsUpdate = true;
    }
  });
}
function setActiveChip(containerId, activeId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.querySelectorAll('.cad-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.id === activeId);
  });
}

// ---------- IMAGE UPLOAD ----------
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('dtcImage');
  if (!fileInput) return;
  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        try {
          if (!cad.initialized) setTimeout(() => applyTexture(img), 300);
          else applyTexture(img);
        } catch (err) { console.error('Texture error:', err); }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
});

function applyTexture(img) {
  if (cad.texture) cad.texture.dispose();
  cad.texture = new THREE.Texture(img);
  cad.texture.needsUpdate = true;
  if (THREE.SRGBColorSpace) cad.texture.colorSpace = THREE.SRGBColorSpace;
  cad.texture.wrapS = THREE.ClampToEdgeWrapping;
  cad.texture.wrapT = THREE.ClampToEdgeWrapping;
  rebuildCadModel();
  const hint = document.getElementById('viewerHint');
  if (hint) {
    hint.textContent = '✅ Photo applied. Rotate to view. Change archetype if the shape is wrong.';
    hint.style.color = '#4a148c';
  }
}

// ---------- MAIN RENDER ----------
function renderDtcTab() {
  if (!dtcProduct && data.products && data.products.length) {
    dtcProduct = data.products[0];
  }
  initDtcState();
  renderLevers();
  updateDtcImpact();
  renderValueMatrix();
  renderActionBoard();
  renderScenarioCompare();
  setTimeout(() => {
    try { initCadViewer(); } catch (err) { console.error('CAD init failed:', err); }
  }, 250);
}

(function watchDtcTab() {
  const target = document.getElementById('tab-dtc');
  if (!target) return;
  const observer = new MutationObserver(() => {
    if (target.classList.contains('active')) renderDtcTab();
  });
  observer.observe(target, { attributes: true, attributeFilter: ['class'] });
})();
