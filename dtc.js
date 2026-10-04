/* ============================================================
   DESIGN-TO-COST / VALUE ENGINEERING TAB  (v2 — CAD Viewer)
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

// 3D viewer state
let cad = {
  scene: null, camera: null, renderer: null, controls: null,
  group: null, edgeLines: null, texture: null,
  archetype: 'shoe',     // 'shoe' | 'boot' | 'shirt'
  viewMode: 'solid',     // 'solid' | 'technical' | 'wireframe'
  projection: 'perspective',
  materialPreset: 'matte',
  width: 260, height: 100, depth: 90,   // mm
  baseColor: '#2d6a4f',
  initialized: false
};

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

function saveDtcState() {
  localStorage.setItem(DTC_STORAGE, JSON.stringify(dtcState));
}

// ---------- COST COMPUTATION ----------
function computeDtcCost(product) {
  const baseCalc = calc(product);

  const designLever = DTC_LEVERS.find(l => l.id === 'designComplexity');
  const designOpt = designLever.options.find(o => o.id === dtcState.designComplexity);

  const materialLever = DTC_LEVERS.find(l => l.id === 'materialSubstitution');
  const materialOpt = materialLever.options.find(o => o.id === dtcState.materialSubstitution);

  const automationLever = DTC_LEVERS.find(l => l.id === 'automation');
  const automationOpt = automationLever.options.find(o => o.id === dtcState.automation);

  const volumeLever = DTC_LEVERS.find(l => l.id === 'volume');
  const volumeOpt = volumeLever.options.find(o => o.id === dtcState.volume);

  const marginLever = DTC_LEVERS.find(l => l.id === 'marginTarget');
  const marginOpt = marginLever.options.find(o => o.id === dtcState.marginTarget);

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
  renderLevers();
  updateDtcImpact();
  renderActionBoard();
  renderScenarioCompare();
  renderValueMatrix();
}

function resetLevers() {
  localStorage.removeItem(DTC_STORAGE);
  dtcState = {};
  initDtcState();
  saveDtcState();
  renderLevers();
  updateDtcImpact();
  renderActionBoard();
  renderScenarioCompare();
  renderValueMatrix();
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
      label: opt.label,
      lever: lever.name,
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
   CAD-STYLE 3D VIEWER
   ============================================================ */

function getMaterialPreset(name) {
  switch (name) {
    case 'matte':      return { roughness: 0.75, metalness: 0.05, clearcoat: 0 };
    case 'gloss':      return { roughness: 0.25, metalness: 0.15, clearcoat: 0.6 };
    case 'metal':      return { roughness: 0.35, metalness: 0.85, clearcoat: 0 };
    case 'leather':    return { roughness: 0.85, metalness: 0.02, clearcoat: 0.1 };
    case 'fabric':     return { roughness: 0.95, metalness: 0.00, clearcoat: 0 };
    case 'recycled':   return { roughness: 0.70, metalness: 0.05, clearcoat: 0.15 };
    default:           return { roughness: 0.6, metalness: 0.05, clearcoat: 0 };
  }
}

// ---------- PROCEDURAL MODELS ----------

function buildShoeModel() {
  const group = new THREE.Group();

  // Sole (bottom slab)
  const soleGeo = new THREE.BoxGeometry(3.0, 0.35, 1.05, 40, 4, 12);
  shapeLateralCurve(soleGeo, 0.10);
  const sole = new THREE.Mesh(soleGeo, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }));
  sole.position.set(0, -0.45, 0);
  group.add(sole);

  // Midsole (curved foam layer)
  const midGeo = new THREE.BoxGeometry(3.0, 0.35, 1.05, 40, 4, 12);
  shapeLateralCurve(midGeo, 0.14);
  const mid = new THREE.Mesh(midGeo, new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.6 }));
  mid.position.set(0, -0.15, 0);
  group.add(mid);

  // Upper (the body of the shoe) — constructed from a wedge-like shape
  const upperGeo = new THREE.BoxGeometry(2.7, 0.85, 1.0, 40, 10, 14);
  shapeUpperProfile(upperGeo);
  const upperMat = new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.7, metalness: 0.05 });
  const upper = new THREE.Mesh(upperGeo, upperMat);
  upper.position.set(-0.05, 0.35, 0);
  upper.userData.isMainSurface = true;
  group.add(upper);

  // Heel counter (back cup)
  const heelGeo = new THREE.CylinderGeometry(0.48, 0.42, 0.85, 24, 4, true);
  const heel = new THREE.Mesh(heelGeo, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 }));
  heel.position.set(1.15, 0.35, 0);
  heel.rotation.z = -0.15;
  group.add(heel);

  // Toe cap
  const toeGeo = new THREE.SphereGeometry(0.42, 20, 12, 0, Math.PI, 0, Math.PI/2);
  const toe = new THREE.Mesh(toeGeo, new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.65 }));
  toe.position.set(-1.4, 0.25, 0);
  toe.rotation.z = Math.PI / 2;
  group.add(toe);

  // Laces (3 thin cylinders)
  for (let i = 0; i < 3; i++) {
    const laceGeo = new THREE.BoxGeometry(0.06, 0.02, 0.55);
    const lace = new THREE.Mesh(laceGeo, new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.9 }));
    lace.position.set(0.3 + i * 0.28, 0.85, 0);
    group.add(lace);
  }

  return group;
}

function buildBootModel() {
  const group = new THREE.Group();

  // Sole
  const soleGeo = new THREE.BoxGeometry(3.0, 0.28, 1.05, 40, 4, 12);
  shapeLateralCurve(soleGeo, 0.08);
  const sole = new THREE.Mesh(soleGeo, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }));
  sole.position.set(0, -0.42, 0);
  group.add(sole);

  // Studs (six small cylinders under sole)
  for (let x = -1.1; x <= 1.1; x += 0.55) {
    for (let z = -0.32; z <= 0.32; z += 0.32) {
      const studGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.14, 8);
      const stud = new THREE.Mesh(studGeo, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 }));
      stud.position.set(x, -0.63, z);
      group.add(stud);
    }
  }

  // Upper — sock-like silhouette
  const upperGeo = new THREE.BoxGeometry(2.7, 0.9, 1.0, 40, 12, 14);
  shapeUpperProfile(upperGeo, 0.55);
  const upper = new THREE.Mesh(upperGeo, new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.65 }));
  upper.position.set(-0.05, 0.38, 0);
  upper.userData.isMainSurface = true;
  group.add(upper);

  // Heel collar (tall)
  const collarGeo = new THREE.CylinderGeometry(0.44, 0.36, 1.0, 24, 4, true);
  const collar = new THREE.Mesh(collarGeo, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 }));
  collar.position.set(1.15, 0.5, 0);
  collar.rotation.z = -0.12;
  group.add(collar);

  // Grip texture strips (3 raised bands)
  for (let i = 0; i < 3; i++) {
    const bandGeo = new THREE.BoxGeometry(0.55, 0.04, 0.95);
    const band = new THREE.Mesh(bandGeo, new THREE.MeshStandardMaterial({ color: 0x1b4332, roughness: 0.4 }));
    band.position.set(-1.0 + i * 0.7, 0.7 - i * 0.05, 0);
    group.add(band);
  }

  return group;
}

function buildShirtModel() {
  const group = new THREE.Group();

  // Main body — rounded rectangle with slight taper
  const bodyGeo = new THREE.BoxGeometry(2.0, 2.6, 0.5, 30, 40, 10);
  shapeShirtBody(bodyGeo);
  const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.9 }));
  body.userData.isMainSurface = true;
  group.add(body);

  // Collar (V-neck rib)
  const collarGeo = new THREE.TorusGeometry(0.42, 0.08, 8, 24, Math.PI);
  const collar = new THREE.Mesh(collarGeo, new THREE.MeshStandardMaterial({ color: 0x1b4332, roughness: 0.85 }));
  collar.position.set(0, 1.2, 0.24);
  collar.rotation.z = Math.PI;
  group.add(collar);

  // Left sleeve
  const sleeveGeoL = new THREE.BoxGeometry(0.9, 0.9, 0.5, 12, 12, 8);
  const sleeveL = new THREE.Mesh(sleeveGeoL, new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.9 }));
  sleeveL.position.set(-1.35, 0.7, 0);
  sleeveL.rotation.z = 0.15;
  group.add(sleeveL);

  // Right sleeve
  const sleeveGeoR = new THREE.BoxGeometry(0.9, 0.9, 0.5, 12, 12, 8);
  const sleeveR = new THREE.Mesh(sleeveGeoR, new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.9 }));
  sleeveR.position.set(1.35, 0.7, 0);
  sleeveR.rotation.z = -0.15;
  group.add(sleeveR);

  // Hem detail line
  const hemGeo = new THREE.BoxGeometry(2.02, 0.06, 0.52);
  const hem = new THREE.Mesh(hemGeo, new THREE.MeshStandardMaterial({ color: 0x1b4332, roughness: 0.85 }));
  hem.position.set(0, -1.25, 0);
  group.add(hem);

  return group;
}

// Geometric shaping helpers
function shapeLateralCurve(geo, strength) {
  const pos = geo.attributes.position;
  const w = 3.0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // Curve the ends down and forward
    const t = x / (w / 2);
    const lift = Math.cos(t * Math.PI / 2) * strength;
    pos.setY(i, pos.getY(i) + lift);
    // Slight forefoot rocker
    if (x > 0.9) pos.setY(i, pos.getY(i) - (x - 0.9) * 0.15);
  }
  geo.computeVertexNormals();
}

function shapeUpperProfile(geo, arch = 0.4) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // Taper front of shoe (toe narrower and lower)
    if (x < -0.6) {
      const t = (x + 1.35) / 0.75;
      pos.setY(i, y * (1 - t * 0.55));
      pos.setZ(i, z * (1 - t * 0.35));
    }
    // Arch on the top surface
    const topness = Math.max(0, y - 0.2) / 0.6;
    if (topness > 0 && Math.abs(z) < 0.4) {
      pos.setY(i, y + Math.sin(x * 1.2) * arch * topness * 0.15);
    }
  }
  geo.computeVertexNormals();
}

function shapeShirtBody(geo) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // Shoulders wider, waist narrower
    const shoulderFactor = 1 + Math.max(0, y) * 0.12;
    const waistFactor = y < -0.5 ? 1 + (y + 0.5) * 0.06 : 1;
    pos.setX(i, x * shoulderFactor * waistFactor);
    // Slight front-body curvature
    if (Math.abs(z) > 0.2) {
      pos.setZ(i, z + Math.sign(z) * Math.cos(x * 1.3) * 0.05);
    }
  }
  geo.computeVertexNormals();
}

// ---------- SCENE ----------
function initCadViewer() {
  const container = document.getElementById('viewer3d');
  if (!container) return;
  if (!window.THREE) {
    container.innerHTML = '<p style="padding:20px;color:#888;">Three.js failed to load. Please refresh.</p>';
    return;
  }

  if (cad.initialized) {
    const w = container.clientWidth, h = container.clientHeight;
    cad.renderer.setSize(w, h);
    cad.camera.aspect = w / h;
    cad.camera.updateProjectionMatrix();
    return;
  }

  const w = container.clientWidth, h = container.clientHeight;

  cad.scene = new THREE.Scene();
  cad.scene.background = new THREE.Color(0xf1f5f9);

  // Camera (perspective default)
  cad.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 1000);
  cad.camera.position.set(3.5, 2.4, 4.2);

  // Renderer
  cad.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  cad.renderer.setSize(w, h);
  cad.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  cad.renderer.shadowMap.enabled = true;
  cad.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(cad.renderer.domElement);

  // Lighting — studio setup
  const hemi = new THREE.HemisphereLight(0xffffff, 0x888899, 0.55);
  cad.scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 0.95);
  key.position.set(4, 6, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  cad.scene.add(key);

  const rim = new THREE.DirectionalLight(0xc7d2fe, 0.5);
  rim.position.set(-5, 2, -4);
  cad.scene.add(rim);

  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(2, -2, 3);
  cad.scene.add(fill);

  // Ground plane (faint grid)
  const grid = new THREE.GridHelper(10, 20, 0xcbd5e1, 0xe2e8f0);
  grid.position.y = -1.6;
  cad.scene.add(grid);

  // Product group
  cad.group = new THREE.Group();
  cad.scene.add(cad.group);

  rebuildCadModel();

  // Controls
  if (typeof THREE.OrbitControls === 'function') {
    cad.controls = new THREE.OrbitControls(cad.camera, cad.renderer.domElement);
    cad.controls.enableDamping = true;
    cad.controls.dampingFactor = 0.08;
    cad.controls.enablePan = true;
    cad.controls.minDistance = 2.5;
    cad.controls.maxDistance = 12;
    cad.controls.target.set(0, 0.2, 0);
  }

  cad.initialized = true;
  animateCad();
}

function rebuildCadModel() {
  if (!cad.group) return;

  // Clear
  while (cad.group.children.length) cad.group.remove(cad.group.children[0]);

  // Build archetype
  let model;
  if (cad.archetype === 'boot')       model = buildBootModel();
  else if (cad.archetype === 'shirt') model = buildShirtModel();
  else                                model = buildShoeModel();

  // Apply material preset and texture
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
      if ('clearcoat' in child.material) child.material.clearcoat = preset.clearcoat;
      child.material.needsUpdate = true;
    }
  });

  cad.group.add(model);

  // Technical edges (added on demand)
  updateEdgeOverlay(model);

  // Update dimension label
  updateDimensionLabel();
}

function updateEdgeOverlay(model) {
  // Remove old edges
  if (cad.edgeLines) {
    cad.group.remove(cad.edgeLines);
    cad.edgeLines = null;
  }
  if (cad.viewMode !== 'technical') return;

  const edgesGroup = new THREE.Group();
  model.traverse(child => {
    if (child.isMesh) {
      const edges = new THREE.EdgesGeometry(child.geometry, 25);
      const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x1a237e, linewidth: 1 }));
      line.position.copy(child.position);
      line.rotation.copy(child.rotation);
      line.scale.copy(child.scale);
      edgesGroup.add(line);
    }
  });
  cad.edgeLines = edgesGroup;
  cad.group.add(cad.edgeLines);
}

function updateDimensionLabel() {
  const el = document.getElementById('dimLabel');
  if (!el) return;
  el.textContent = `L × W × H: ${cad.width} × ${cad.depth} × ${cad.height} mm`;
}

function animateCad() {
  requestAnimationFrame(animateCad);
  if (cad.controls) cad.controls.update();
  if (cad.renderer && cad.scene && cad.camera) {
    cad.renderer.render(cad.scene, cad.camera);
  }
}

// ---------- VIEW CONTROLS ----------
function setArchetype(type) {
  cad.archetype = type;
  rebuildCadModel();
  setActiveChip('archetypeChips', type);
}

function setViewMode(mode) {
  cad.viewMode = mode;
  if (mode === 'wireframe') {
    cad.group.traverse(c => { if (c.isMesh) { c.material.wireframe = true; c.material.needsUpdate = true; } });
  } else {
    cad.group.traverse(c => { if (c.isMesh) { c.material.wireframe = false; c.material.needsUpdate = true; } });
  }
  // Rebuild edges for technical mode
  const model = cad.group.children.find(c => !c.isLineSegments && c.type === 'Group');
  if (model) updateEdgeOverlay(model);
  setActiveChip('viewChips', mode);
}

function setProjection(proj) {
  const container = document.getElementById('viewer3d');
  if (!container) return;
  const w = container.clientWidth, h = container.clientHeight;
  const aspect = w / h;
  const target = cad.controls ? cad.controls.target : new THREE.Vector3(0, 0.2, 0);
  const oldPos = cad.camera.position.clone();

  if (proj === 'orthographic') {
    const size = 3.5;
    cad.camera = new THREE.OrthographicCamera(
      -size * aspect, size * aspect, size, -size, 0.1, 1000
    );
    cad.camera.position.copy(oldPos);
    cad.camera.lookAt(target);
  } else {
    cad.camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 1000);
    cad.camera.position.copy(oldPos);
    cad.camera.lookAt(target);
  }

  // Rebuild controls with new camera
  if (typeof THREE.OrbitControls === 'function') {
    if (cad.controls) cad.controls.dispose();
    cad.controls = new THREE.OrbitControls(cad.camera, cad.renderer.domElement);
    cad.controls.enableDamping = true;
    cad.controls.dampingFactor = 0.08;
    cad.controls.target.copy(target);
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
  if (cad.texture) return; // texture overrides
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
          if (cad.texture) cad.texture.dispose();
          cad.texture = new THREE.Texture(img);
          cad.texture.needsUpdate = true;
          if (THREE.SRGBColorSpace) cad.texture.colorSpace = THREE.SRGBColorSpace;
          cad.texture.wrapS = THREE.ClampToEdgeWrapping;
          cad.texture.wrapT = THREE.ClampToEdgeWrapping;
          rebuildCadModel();

          // Show a hint if archetype might not match
          const hint = document.getElementById('viewerHint');
          if (hint) {
            hint.textContent = '✅ Photo applied. If the wrap looks off, try a different archetype below.';
            hint.style.color = '#4a148c';
          }
        } catch (err) { console.error('Texture apply failed:', err); }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
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

  setTimeout(() => {
    try { initCadViewer(); } catch (err) { console.error('CAD init failed:', err); }
  }, 150);
}

// Auto-run when the tab becomes active
(function watchDtcTab() {
  const target = document.getElementById('tab-dtc');
  if (!target) return;
  const observer = new MutationObserver(() => {
    if (target.classList.contains('active')) renderDtcTab();
  });
  observer.observe(target, { attributes: true, attributeFilter: ['class'] });
})();
