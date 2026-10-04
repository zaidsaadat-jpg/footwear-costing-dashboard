/* ============================================================
   DESIGN-TO-COST / VALUE ENGINEERING TAB
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
let dtcMesh = null, dtcScene = null, dtcCamera = null, dtcRenderer = null, dtcControls = null;
let dtcTexture = null, dtcBaseColor = '#2d6a4f';
let valueMatrixChart = null;

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

// ---------- RENDER LEVERS ----------
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
      <div class="lever-options">${optionsHtml}</div>
    `;
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
  renderLevers();
  updateDtcImpact();
  renderActionBoard();
  renderScenarioCompare();
  renderValueMatrix();
}

function applyPremiumScenario() {
  dtcState.designComplexity = 'complex';
  dtcState.materialSubstitution = 'bio';
  dtcState.automation = 'full';
  dtcState.volume = 'high';
  dtcState.marginTarget = 'premium';
  saveDtcState();
  renderLevers();
  updateDtcImpact();
  renderActionBoard();
  renderScenarioCompare();
  renderValueMatrix();
}

// ---------- IMPACT PANEL ----------
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
    const points = lever.options.map(opt => {
      const cost = ((opt.costMultiplier || 1) - 1) * 100;
      const value = ((opt.valueMultiplier || 1) - 1) * 100;
      const isActive = dtcState[lever.id] === opt.id;
      return {
        x: cost,
        y: value,
        label: opt.label,
        lever: lever.name,
        r: isActive ? 12 : 6
      };
    });
    datasets.push({
      label: lever.name,
      data: points,
      backgroundColor: palette[idx % palette.length],
      borderColor: '#fff',
      borderWidth: 2,
      pointRadius: points.map(p => p.r),
      pointHoverRadius: 14
    });
  });

  valueMatrixChart = new Chart(ctx, {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              const p = ctx.raw;
              return `${p.lever}: ${p.label} (Cost ${p.x >= 0 ? '+' : ''}${p.x.toFixed(0)}%, Value ${p.y >= 0 ? '+' : ''}${p.y.toFixed(0)}%)`;
            }
          }
        },
        title: {
          display: true,
          text: 'Cost impact (X) vs Value impact (Y) — larger bubbles = currently selected',
          font: { size: 12, weight: 'normal' },
          color: '#666'
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Cost impact (%) — negative = cheaper' },
          grid: { color: ctx => ctx.tick.value === 0 ? '#999' : '#eee' },
          min: -25, max: 25
        },
        y: {
          title: { display: true, text: 'Value impact (%) — positive = higher perceived value' },
          grid: { color: ctx => ctx.tick.value === 0 ? '#999' : '#eee' },
          min: -15, max: 35
        }
      }
    }
  });
}

// ---------- ACTION BOARD ----------
function renderActionBoard() {
  const board = document.getElementById('actionBoard');
  if (!board) return;
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
      </div>
    `;
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
    <div class="scenario-line highlight"><span class="lbl"><strong>FOB</strong></span><span class="val">${fmt(base.fob)}</span></div>
  `;

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
    <div class="scenario-line highlight"><span class="lbl"><strong>Total Unit Cost</strong></span><span class="val">${fmt(curr.totalUnitCost)}</span></div>
  `;

  wrap.appendChild(baselineCol);
  wrap.appendChild(optCol);
}

// ---------- 3D VIEWER ----------
function init3DViewer() {
  const container = document.getElementById('viewer3d');
  if (!container) return;
  if (!window.THREE) { container.innerHTML = '<p style="padding:20px;color:#888;">Three.js failed to load</p>'; return; }
  if (dtcRenderer) {
    // Already initialized — just resize in case container changed
    const w = container.clientWidth, h = container.clientHeight;
    dtcRenderer.setSize(w, h);
    dtcCamera.aspect = w / h;
    dtcCamera.updateProjectionMatrix();
    return;
  }

  const w = container.clientWidth;
  const h = container.clientHeight;

  dtcScene = new THREE.Scene();
  dtcScene.background = new THREE.Color(0xf1f5f9);

  dtcCamera = new THREE.PerspectiveCamera(45, w/h, 0.1, 1000);
  dtcCamera.position.set(0, 0.5, 4.5);

  dtcRenderer = new THREE.WebGLRenderer({ antialias: true });
  dtcRenderer.setSize(w, h);
  dtcRenderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(dtcRenderer.domElement);

  dtcScene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(3, 4, 5);
  dtcScene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.35);
  rim.position.set(-4, -2, 2);
  dtcScene.add(rim);
  const fill = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4);
  dtcScene.add(fill);

  const geo = new THREE.BoxGeometry(2.6, 1.7, 0.55, 30, 30, 30);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (Math.abs(z) > 0.2) {
      const bulge = Math.cos(x * 0.55) * 0.18 + Math.cos(y * 0.85) * 0.12;
      pos.setZ(i, z + Math.sign(z) * bulge);
    }
  }
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(dtcBaseColor),
    roughness: 0.42,
    metalness: 0.08
  });

  dtcMesh = new THREE.Mesh(geo, mat);
  dtcScene.add(dtcMesh);

  const groundGeo = new THREE.PlaneGeometry(8, 8);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 1 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.15;
  dtcScene.add(ground);

  if (typeof THREE.OrbitControls === 'function') {
    dtcControls = new THREE.OrbitControls(dtcCamera, dtcRenderer.domElement);
    dtcControls.enableDamping = true;
    dtcControls.dampingFactor = 0.08;
    dtcControls.enableZoom = true;
    dtcControls.enablePan = false;
    dtcControls.minDistance = 2.5;
    dtcControls.maxDistance = 8;
  }

  animate3D();
}

function animate3D() {
  requestAnimationFrame(animate3D);
  if (dtcControls) dtcControls.update();
  else if (dtcMesh) dtcMesh.rotation.y += 0.003;
  if (dtcRenderer && dtcScene && dtcCamera) dtcRenderer.render(dtcScene, dtcCamera);
}

function updateMeshColor() {
  dtcBaseColor = document.getElementById('meshColor').value;
  if (dtcMesh && !dtcTexture) dtcMesh.material.color.set(dtcBaseColor);
}

function toggleWireframe() {
  if (!dtcMesh) return;
  dtcMesh.material.wireframe = document.getElementById('wireframeToggle').checked;
  dtcMesh.material.needsUpdate = true;
}

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('dtcImage');
  if (fileInput) {
    fileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          try {
            if (!dtcMesh) { console.warn('3D mesh not ready yet'); return; }
            if (dtcTexture) dtcTexture.dispose();
            dtcTexture = new THREE.Texture(img);
            dtcTexture.needsUpdate = true;
            if (THREE.SRGBColorSpace) dtcTexture.colorSpace = THREE.SRGBColorSpace;
            dtcMesh.material.map = dtcTexture;
            dtcMesh.material.color.set(0xffffff);
            dtcMesh.material.needsUpdate = true;
          } catch (err) { console.error('Texture apply failed:', err); }
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  }
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
    try { init3DViewer(); } catch (err) { console.error('3D init failed:', err); }
  }, 150);
}

// Auto-run when the tab becomes active
(function watchDtcTab() {
  const target = document.getElementById('tab-dtc');
  if (!target) return;
  const observer = new MutationObserver(() => {
    if (target.classList.contains('active')) {
      renderDtcTab();
    }
  });
  observer.observe(target, { attributes: true, attributeFilter: ['class'] });
})();
