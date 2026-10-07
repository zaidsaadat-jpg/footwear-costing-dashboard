/* ============================================================
   DESIGN-TO-COST / VALUE ENGINEERING TAB  (v7 — GLB upload + progress)
   ============================================================ */

const DTC_STORAGE = 'puma_dtc_scenario_v1';

const DTC_LEVERS = [
  { id: 'designComplexity', name: 'Design Complexity', owner: 'Design', desc: 'Number of panels, seams, decorative elements', appliesTo: 'materialsAndLabour',
    options: [
      { id: 'simple',   label: 'Simple',   costMultiplier: 0.85, valueMultiplier: 0.90, costHint: '−15%' },
      { id: 'standard', label: 'Standard', costMultiplier: 1.00, valueMultiplier: 1.00, costHint: 'base' },
      { id: 'complex',  label: 'Complex',  costMultiplier: 1.20, valueMultiplier: 1.25, costHint: '+20%' }
    ]
  },
  { id: 'materialSubstitution', name: 'Material Substitution', owner: 'Design + Procurement', desc: 'Raw material source and type', appliesTo: 'materials',
    options: [
      { id: 'premium',  label: 'Premium virgin', costMultiplier: 1.15, valueMultiplier: 1.10, costHint: '+15%' },
      { id: 'standard', label: 'Standard',        costMultiplier: 1.00, valueMultiplier: 1.00, costHint: 'base' },
      { id: 'recycled', label: 'Recycled',        costMultiplier: 0.95, valueMultiplier: 1.20, costHint: '−5%' },
      { id: 'bio',      label: 'Bio-based',       costMultiplier: 1.10, valueMultiplier: 1.30, costHint: '+10%' }
    ]
  },
  { id: 'automation', name: 'Operations Automation', owner: 'Engineering + Ops', desc: 'Level of automated cutting, stitching, assembly', appliesTo: 'labour',
    options: [
      { id: 'manual', label: 'Manual',     costMultiplier: 1.20, valueMultiplier: 0.95, costHint: '+20%' },
      { id: 'semi',   label: 'Semi-auto',  costMultiplier: 1.00, valueMultiplier: 1.00, costHint: 'base' },
      { id: 'full',   label: 'Fully auto', costMultiplier: 0.88, valueMultiplier: 1.05, costHint: '−12%' }
    ]
  },
  { id: 'volume', name: 'Order Volume (per SKU)', owner: 'Procurement + Finance', desc: 'Annual order quantity, affects fixed cost amortisation', appliesTo: 'volume',
    options: [
      { id: 'low',  label: '1,000',   volumeMultiplier: 0.2,  costHint: '0.2×' },
      { id: 'mid',  label: '5,000',   volumeMultiplier: 1.0,  costHint: '1×' },
      { id: 'high', label: '25,000',  volumeMultiplier: 5.0,  costHint: '5×' },
      { id: 'mass', label: '100,000', volumeMultiplier: 20.0, costHint: '20×' }
    ]
  },
  { id: 'marginTarget', name: 'Factory Margin Target', owner: 'Finance + Procurement', desc: 'Margin the factory earns on FOB', appliesTo: 'margin',
    options: [
      { id: 'lean',    label: '6% (lean)',     margin: 6,  costHint: '−3pp' },
      { id: 'base',    label: '9% (base)',     margin: 9,  costHint: 'base' },
      { id: 'premium', label: '12% (premium)', margin: 12, costHint: '+3pp' },
      { id: 'high',    label: '15% (high)',    margin: 15, costHint: '+6pp' }
    ]
  }
];

const BUILTIN_GLB = {
  shoe:  'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/MaterialsVariantsShoe/glTF-Binary/MaterialsVariantsShoe.glb',
  boot:  null,
  shirt: null
};

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
  lastW: 0, lastH: 0,
  currentModel: null,
  loadedGLBs: {},
  customGLB: null
};

// ---------- HELPERS ----------
function interp(t, table) {
  if (t <= table[0][0]) return table[0][1];
  if (t >= table[table.length - 1][0]) return table[table.length - 1][1];
  for (let i = 0; i < table.length - 1; i++) {
    const [t0, v0] = table[i];
    const [t1, v1] = table[i + 1];
    if (t >= t0 && t <= t1) {
      const u = (t - t0) / (t1 - t0);
      const s = u * u * (3 - 2 * u);
      return v0 + (v1 - v0) * s;
    }
  }
  return table[table.length - 1][1];
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '';
  if (seconds < 1) return '< 1s';
  if (seconds < 60) return Math.ceil(seconds) + 's';
  const mins = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  return mins + 'm ' + secs + 's';
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
   3D VIEWER
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

// ---------- PROCEDURAL FALLBACKS ----------
function buildProceduralShoe() {
  const group = new THREE.Group();
  const soleShape = new THREE.Shape();
  soleShape.moveTo(-1.50, -0.05);
  soleShape.bezierCurveTo(-1.55, 0.05, -1.55, 0.15, -1.50, 0.20);
  soleShape.bezierCurveTo(-1.20, 0.22, -0.60, 0.22, 0.00, 0.22);
  soleShape.bezierCurveTo(0.60, 0.22, 1.20, 0.22, 1.55, 0.20);
  soleShape.bezierCurveTo(1.62, 0.15, 1.62, 0.05, 1.58, -0.05);
  soleShape.bezierCurveTo(1.30, -0.10, 0.60, -0.12, 0.00, -0.12);
  soleShape.bezierCurveTo(-0.60, -0.12, -1.20, -0.10, -1.50, -0.05);
  const upperShape = new THREE.Shape();
  upperShape.moveTo(-1.45, -0.10);
  upperShape.bezierCurveTo(-1.52, 0.15, -1.52, 0.45, -1.45, 0.70);
  upperShape.bezierCurveTo(-1.38, 0.88, -1.20, 0.98, -0.95, 0.98);
  upperShape.bezierCurveTo(-0.72, 0.98, -0.55, 0.85, -0.42, 0.82);
  upperShape.bezierCurveTo(-0.25, 0.80, -0.05, 0.78, 0.15, 0.72);
  upperShape.bezierCurveTo(0.42, 0.62, 0.68, 0.48, 0.92, 0.36);
  upperShape.bezierCurveTo(1.18, 0.24, 1.38, 0.12, 1.50, 0.00);
  upperShape.bezierCurveTo(1.58, -0.10, 1.58, -0.22, 1.52, -0.30);
  upperShape.bezierCurveTo(1.42, -0.36, 1.20, -0.38, 0.90, -0.40);
  upperShape.bezierCurveTo(0.45, -0.42, 0.00, -0.42, -0.45, -0.42);
  upperShape.bezierCurveTo(-0.90, -0.42, -1.30, -0.40, -1.45, -0.10);
  const outGeo = new THREE.ExtrudeGeometry(soleShape, { steps: 1, depth: 0.88, curveSegments: 48, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 5 });
  outGeo.translate(0, -0.55, -0.44);
  sculptGeometry(outGeo, { minX: -1.60, maxX: 1.62, widthTable: [[0, 0.92], [0.18, 0.98], [0.40, 0.86], [0.65, 0.98], [0.85, 0.72], [0.95, 0.50], [1, 0.20]], heightTable: [[0, 1], [0.3, 0.95], [0.6, 0.9], [0.85, 0.85], [1, 0.85]], soleShiftTable: [[0, -0.05], [0.3, 0], [0.7, 0.05], [1, 0.18]] });
  group.add(new THREE.Mesh(outGeo, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.92 })));
  const midGeo = new THREE.ExtrudeGeometry(soleShape, { steps: 1, depth: 0.90, curveSegments: 48, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 6 });
  midGeo.translate(0, -0.22, -0.45);
  sculptGeometry(midGeo, { minX: -1.60, maxX: 1.62, widthTable: [[0, 0.94], [0.18, 1], [0.4, 0.88], [0.65, 1], [0.85, 0.74], [1, 0.3]], heightTable: [[0, 1.05], [0.25, 1], [0.55, 0.95], [0.85, 0.85], [1, 0.75]], soleShiftTable: [[0, -0.03], [0.3, 0], [0.7, 0.05], [1, 0.15]], topShiftTable: [[0, 0], [0.5, 0], [0.8, -0.02], [1, -0.05]] });
  group.add(new THREE.Mesh(midGeo, new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.65 })));
  const upperGeo = new THREE.ExtrudeGeometry(upperShape, { steps: 1, depth: 0.85, curveSegments: 48, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 8 });
  upperGeo.translate(0, 0.22, -0.425);
  sculptGeometry(upperGeo, { minX: -1.55, maxX: 1.58, widthTable: [[0, 0.92], [0.15, 0.98], [0.4, 0.82], [0.62, 0.94], [0.8, 0.72], [0.95, 0.42], [1, 0.18]], heightTable: [[0, 1], [0.15, 1.02], [0.3, 0.92], [0.5, 0.88], [0.75, 0.8], [0.92, 0.62], [1, 0.42]], topShiftTable: [[0, 0], [0.25, 0.02], [0.55, -0.05], [0.8, -0.15], [1, -0.25]], soleShiftTable: [[0, 0], [0.6, 0], [0.85, 0.04], [1, 0.10]] });
  const upper = new THREE.Mesh(upperGeo, new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.72 }));
  upper.userData.isMainSurface = true;
  group.add(upper);
  group.position.set(0, 0.05, 0);
  return group;
}
function buildProceduralBoot() { return buildProceduralShoe(); }
function buildProceduralShirt() {
  const group = new THREE.Group();
  const bodyShape = new THREE.Shape();
  bodyShape.moveTo(-0.85, 1.30);
  bodyShape.bezierCurveTo(-1.05, 1.22, -1.35, 1.00, -1.50, 0.68);
  bodyShape.bezierCurveTo(-1.62, 0.38, -1.55, 0.05, -1.42, -0.10);
  bodyShape.bezierCurveTo(-1.30, -0.22, -1.18, -0.15, -1.15, 0.02);
  bodyShape.bezierCurveTo(-1.10, -0.42, -1.08, -0.85, -1.10, -1.25);
  bodyShape.bezierCurveTo(-1.12, -1.36, -1.00, -1.42, -0.85, -1.42);
  bodyShape.bezierCurveTo(-0.35, -1.46, 0.35, -1.46, 0.85, -1.42);
  bodyShape.bezierCurveTo(1.00, -1.42, 1.12, -1.36, 1.10, -1.25);
  bodyShape.bezierCurveTo(1.08, -0.85, 1.10, -0.42, 1.15, 0.02);
  bodyShape.bezierCurveTo(1.18, -0.15, 1.30, -0.22, 1.42, -0.10);
  bodyShape.bezierCurveTo(1.55, 0.05, 1.62, 0.38, 1.50, 0.68);
  bodyShape.bezierCurveTo(1.35, 1.00, 1.05, 1.22, 0.85, 1.30);
  bodyShape.bezierCurveTo(0.55, 1.24, 0.28, 1.00, 0.00, 1.00);
  bodyShape.bezierCurveTo(-0.28, 1.00, -0.55, 1.24, -0.85, 1.30);
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, { steps: 1, depth: 0.38, curveSegments: 40, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 6 });
  bodyGeo.translate(0, 0, -0.19);
  const pos = bodyGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = Math.max(0, Math.min(1, (1.2 - y) / 2.6));
    const widthFactor = interp(t, [[0, 1.02], [0.20, 1], [0.45, 0.94], [0.70, 0.96], [1, 0.98]]);
    const chestBulge = Math.exp(-Math.pow((y - 0.30) / 0.55, 2)) * 0.14;
    pos.setX(i, x * widthFactor);
    pos.setZ(i, z + Math.sign(z) * chestBulge);
  }
  bodyGeo.computeVertexNormals();
  const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.92 }));
  body.userData.isMainSurface = true;
  group.add(body);
  group.scale.set(0.82, 0.82, 0.82);
  group.position.set(0, 0.10, 0);
  return group;
}
function sculptGeometry(geo, opts) {
  const pos = geo.attributes.position;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const yRange = maxY - minY;
  const length = opts.maxX - opts.minX;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = Math.max(0, Math.min(1, (x - opts.minX) / length));
    const widthFactor = interp(t, opts.widthTable);
    const heightFactor = interp(t, opts.heightTable);
    const topShift = interp(t, opts.topShiftTable || [[0,0],[1,0]]);
    const soleShift = interp(t, opts.soleShiftTable || [[0,0],[1,0]]);
    const yNorm = (y - minY) / yRange;
    const yScaled = minY + yRange * yNorm * heightFactor;
    const yFinal = yScaled + topShift * yNorm + soleShift * (1 - yNorm);
    pos.setZ(i, z * widthFactor);
    pos.setY(i, yFinal);
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------- GLB LOADING ----------
function loadGLBModel(url, archetype) {
  return new Promise((resolve, reject) => {
    if (!THREE.GLTFLoader) { reject(new Error('GLTFLoader not loaded')); return; }
    const loader = new THREE.GLTFLoader();
    loader.load(url,
      gltf => {
        const scene = gltf.scene;
        const box = new THREE.Box3().setFromObject(scene);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const targetLength = 3.2;
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = targetLength / maxDim;
        scene.scale.setScalar(scale);
        scene.position.sub(center.multiplyScalar(scale));
        scene.position.y += 0.1;
        scene.traverse(child => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material) child.material.side = THREE.DoubleSide;
          }
        });
        cad.loadedGLBs[archetype] = scene;
        resolve(scene);
      },
      undefined,
      err => { console.warn('GLB load failed for', archetype, ':', err); reject(err); }
    );
  });
}

function applyMaterialPresetToModel(model) {
  const preset = getMaterialPreset(cad.materialPreset);
  model.traverse(child => {
    if (child.isMesh && child.material) {
      child.material.roughness = preset.roughness;
      child.material.metalness = preset.metalness;
      child.material.wireframe = (cad.viewMode === 'wireframe');
      if (cad.texture && child.userData.isMainSurface) {
        child.material.map = cad.texture;
        child.material.color.set(0xffffff);
      }
      child.material.needsUpdate = true;
    }
  });
}

async function rebuildCadModel() {
  if (!cad.group) return;
  while (cad.group.children.length) cad.group.remove(cad.group.children[0]);
  cad.edgeLines = null;

  if (cad.customGLB) {
    applyMaterialPresetToModel(cad.customGLB);
    cad.group.add(cad.customGLB);
    cad.currentModel = cad.customGLB;
    updateEdgeOverlay(cad.customGLB);
    return;
  }

  const glbUrl = BUILTIN_GLB[cad.archetype];

  if (glbUrl) {
    if (cad.loadedGLBs[cad.archetype]) {
      const model = cad.loadedGLBs[cad.archetype];
      applyMaterialPresetToModel(model);
      cad.group.add(model);
      cad.currentModel = model;
      updateEdgeOverlay(model);
      return;
    }
    try {
      const model = await loadGLBModel(glbUrl, cad.archetype);
      applyMaterialPresetToModel(model);
      cad.group.add(model);
      cad.currentModel = model;
      updateEdgeOverlay(model);
      return;
    } catch (err) {
      console.warn('Falling back to procedural model for', cad.archetype);
    }
  }

  let model;
  if (cad.archetype === 'boot')       model = buildProceduralBoot();
  else if (cad.archetype === 'shirt') model = buildProceduralShirt();
  else                                model = buildProceduralShoe();

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
  cad.currentModel = model;
  updateEdgeOverlay(model);
}

function updateEdgeOverlay(model) {
  if (!model) return;
  if (cad.edgeLines) { cad.group.remove(cad.edgeLines); cad.edgeLines = null; }
  if (cad.viewMode !== 'technical' || !THREE.EdgesGeometry) return;
  const edgesGroup = new THREE.Group();
  model.traverse(child => {
    if (child.isMesh) {
      try {
        const edges = new THREE.EdgesGeometry(child.geometry, 30);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x1a237e }));
        line.position.copy(child.position);
        line.rotation.copy(child.rotation);
        line.scale.copy(child.scale);
        edgesGroup.add(line);
      } catch (e) {}
    }
  });
  cad.edgeLines = edgesGroup;
  cad.group.add(cad.edgeLines);
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

  cad.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.65));
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

  rebuildCadModel().catch(err => console.error('Initial model build failed:', err));

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
  cad.customGLB = null;
  rebuildCadModel();
  setActiveChip('archetypeChips', type);
}
function setViewMode(mode) {
  cad.viewMode = mode;
  cad.group.traverse(c => {
    if (c.isMesh) { c.material.wireframe = (mode === 'wireframe'); c.material.needsUpdate = true; }
  });
  const model = cad.currentModel;
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
  applyMaterialPresetToModel(cad.currentModel);
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
function resetToBuiltIn() {
  cad.customGLB = null;
  const hint = document.getElementById('viewerHint');
  if (hint) {
    hint.textContent = '🖱️ Drag to rotate · Scroll to zoom · Right-click drag to pan';
    hint.style.color = '#999';
  }
  rebuildCadModel();
}

// ============================================================
// GLB UPLOAD WITH PROGRESS TRACKER
// ============================================================

function initUploadZone() {
  const zone = document.getElementById('glbUploadZone');
  const input = document.getElementById('glbInput');
  if (!zone || !input) return;

  // Prevent duplicate listeners
  if (zone.dataset.wired === '1') return;
  zone.dataset.wired = '1';

  zone.addEventListener('click', e => {
    if (e.target === input) return;
    input.click();
  });

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragleave', e => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove('dragover');
  });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      handleGLBFile(e.dataTransfer.files[0]);
    }
  });

  input.addEventListener('change', e => {
    if (e.target.files && e.target.files.length) {
      handleGLBFile(e.target.files[0]);
    }
    e.target.value = ''; // allow re-uploading the same file
  });
}

function setProgressState({ percent, status, eta, state }) {
  const progress = document.getElementById('uploadProgress');
  const fill = document.getElementById('uploadProgressFill');
  const text = document.getElementById('uploadProgressText');
  const etaEl = document.getElementById('uploadProgressEta');
  if (!progress || !fill || !text || !etaEl) return;

  progress.style.display = 'block';
  if (percent != null) fill.style.width = percent + '%';
  if (status != null) text.textContent = status;
  if (eta != null) etaEl.textContent = eta;
  if (state === 'error') fill.classList.add('error');
  else fill.classList.remove('error');
  if (state === 'success') fill.classList.add('success');
  else fill.classList.remove('success');
}

function hideProgress(delay = 2500) {
  setTimeout(() => {
    const progress = document.getElementById('uploadProgress');
    if (progress) progress.style.display = 'none';
    const fill = document.getElementById('uploadProgressFill');
    if (fill) { fill.style.width = '0%'; fill.classList.remove('error', 'success'); }
    const zone = document.getElementById('glbUploadZone');
    if (zone) zone.classList.remove('uploading');
  }, delay);
}

function handleGLBFile(file) {
  const zone = document.getElementById('glbUploadZone');
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.glb') && !file.name.toLowerCase().endsWith('.gltf')) {
    setProgressState({ percent: 100, status: '❌ Not a valid .glb or .gltf file', state: 'error' });
    hideProgress(3500);
    return;
  }

  if (zone) zone.classList.add('uploading');

  const fileSize = file.size;
  const sizeText = formatBytes(fileSize);

  setProgressState({
    percent: 0,
    status: `Reading ${file.name} (${sizeText})…`,
    eta: '',
    state: 'normal'
  });

  const startTime = Date.now();
  const reader = new FileReader();

  reader.onprogress = e => {
    if (e.lengthComputable) {
      const percent = Math.min(99, (e.loaded / e.total) * 100);
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = e.loaded / Math.max(elapsed, 0.1); // bytes/sec
      const remaining = (e.total - e.loaded) / Math.max(rate, 1);
      setProgressState({
        percent,
        status: `Reading file… ${percent.toFixed(0)}% · ${formatBytes(e.loaded)} / ${sizeText}`,
        eta: remaining > 0.5 ? `~${formatTime(remaining)} left` : 'almost done',
        state: 'normal'
      });
    }
  };

  reader.onload = e => {
    const arrayBuffer = e.target.result;
    setProgressState({
      percent: 100,
      status: '✅ File read. Parsing 3D model…',
      eta: 'this may take a moment',
      state: 'normal'
    });

    const parseStart = Date.now();
    const parseTimer = setInterval(() => {
      const elapsed = ((Date.now() - parseStart) / 1000).toFixed(1);
      setProgressState({
        status: `Parsing 3D model… ${elapsed}s`,
        eta: fileSize > 5 * 1024 * 1024 ? 'large file — please wait' : '',
        state: 'normal'
      });
    }, 200);

    if (!THREE.GLTFLoader) {
      clearInterval(parseTimer);
      setProgressState({ status: '❌ GLTFLoader not available', state: 'error' });
      hideProgress(3500);
      if (zone) zone.classList.remove('uploading');
      return;
    }

    const loader = new THREE.GLTFLoader();
    try {
      loader.parse(arrayBuffer, '', gltf => {
        clearInterval(parseTimer);
        const scene = gltf.scene;

        // Auto-scale to fit viewer
        const box = new THREE.Box3().setFromObject(scene);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 3.2 / maxDim;
        scene.scale.setScalar(scale);
        scene.position.sub(center.multiplyScalar(scale));
        scene.position.y += 0.1;
        scene.traverse(child => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material) child.material.side = THREE.DoubleSide;
          }
        });

        cad.customGLB = scene;
        applyMaterialPresetToModel(scene);
        while (cad.group.children.length) cad.group.remove(cad.group.children[0]);
        cad.group.add(scene);
        cad.currentModel = scene;
        updateEdgeOverlay(scene);

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        setProgressState({
          percent: 100,
          status: `✅ ${file.name} loaded in ${totalTime}s`,
          eta: '',
          state: 'success'
        });
        hideProgress(3000);

        const hint = document.getElementById('viewerHint');
        if (hint) {
          hint.textContent = `✅ Loaded: ${file.name} (${sizeText}) · Drag to rotate`;
          hint.style.color = '#2d6a4f';
        }
      }, err => {
        clearInterval(parseTimer);
        console.error('GLTF parse error:', err);
        setProgressState({
          status: '❌ Failed to parse. The file may be corrupted or in an unsupported format.',
          state: 'error'
        });
        hideProgress(5000);
        if (zone) zone.classList.remove('uploading');
      });
    } catch (err) {
      clearInterval(parseTimer);
      console.error('Loader exception:', err);
      setProgressState({ status: '❌ Unexpected error: ' + err.message, state: 'error' });
      hideProgress(5000);
      if (zone) zone.classList.remove('uploading');
    }
  };

  reader.onerror = () => {
    setProgressState({ status: '❌ Failed to read the file', state: 'error' });
    hideProgress(3500);
    if (zone) zone.classList.remove('uploading');
  };

  reader.readAsArrayBuffer(file);
}

// ============================================================
// BOOT
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  initUploadZone();
});

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
  initUploadZone();
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
